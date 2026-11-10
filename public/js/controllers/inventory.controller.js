// public/js/controllers/inventory.controller.js
import { supabase } from '../config/supabase.js';
import { navigateTo } from '../core/router.js';
import { showToast } from '../ui/toast.js';
import { getActiveHousehold } from '../core/household.js';

let currentUser = null;
let currentAuthorName = 'Miembro';
let activeHousehold = null;
let allItems = [];
let activeFilter = 'all';
let searchQuery = '';

function escapeHTML(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Dentro de initInventory() en public/js/controllers/inventory.controller.js:
export async function initInventory() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        navigateTo('/');
        return;
    }
    currentUser = user;
    activeFilter = 'all';
    searchQuery = '';
    const meta = user.user_metadata || {};
    currentAuthorName = meta.nickname || meta.full_name?.split(' ')[0] || user.email.split('@')[0];

    activeHousehold = await getActiveHousehold(user.id);

    bindInventoryEvents();
    await loadInventory();
}

async function loadInventory() {
    try {
        let query = supabase.from('inventory_items').select('*').order('name', { ascending: true });
        if (activeHousehold) {
            query = query.or(`user_id.eq.${currentUser.id},household_id.eq.${activeHousehold.id}`);
        } else {
            query = query.eq('user_id', currentUser.id);
        }

        const { data, error } = await query;
        if (error) throw error;

        allItems = data || [];
        renderInventoryAndKPIs();
    } catch (err) {
        console.error('Error cargando inventario:', err);
        showToast('No se pudo sincronizar la despensa', 'error');
    }
}

function getDaysUntilExpiry(expiryStr) {
    if (!expiryStr) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp = new Date(expiryStr + 'T00:00:00');
    return Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
}

function renderInventoryAndKPIs() {
    const lowStock = allItems.filter(i => Number(i.quantity) <= Number(i.min_stock));
    const expiring = allItems.filter(i => {
        const d = getDaysUntilExpiry(i.expiry_date);
        return d !== null && d <= 7;
    });
    const shopping = allItems.filter(i => i.in_shopping_list || Number(i.quantity) <= Number(i.min_stock));

    document.getElementById('invTotalItems').textContent = allItems.length;
    document.getElementById('invLowStockCount').textContent = lowStock.length;
    document.getElementById('invExpiringCount').textContent = expiring.length;
    document.getElementById('invShoppingCount').textContent = shopping.length;

    renderShoppingSidebar(shopping);
    renderMainInventoryList();
}

function renderShoppingSidebar(shoppingItems) {
    const sideContainer = document.getElementById('shoppingListSideContainer');
    const badge = document.getElementById('shoppingSideBadge');
    const checkoutBox = document.getElementById('shoppingCheckoutBox');

    if (badge) badge.textContent = `${shoppingItems.length} ítems`;
    if (!sideContainer) return;

    if (shoppingItems.length === 0) {
        sideContainer.innerHTML = `<p style="color: var(--text-muted); font-size: 0.82rem; margin: 0;">Todo abastecido. No hay compras urgentes.</p>`;
        if (checkoutBox) checkoutBox.style.display = 'none';
        return;
    }

    if (checkoutBox) checkoutBox.style.display = 'block';

    sideContainer.innerHTML = shoppingItems.map(item => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--bg-color); border-radius: 10px; border: 1px solid var(--border-card);">
            <span style="font-size: 0.83rem; font-weight: 600; color: var(--text-main);">${escapeHTML(item.name)}</span>
            <span style="font-size: 0.75rem; color: var(--warning-color, #f59e0b);">Actual: ${Number(item.quantity)} ${escapeHTML(item.unit)}</span>
        </div>
    `).join('');
}

function renderMainInventoryList() {
    const container = document.getElementById('inventoryItemsContainer');
    if (!container) return;

    let filtered = allItems;
    if (activeFilter === 'low') {
        filtered = filtered.filter(i => Number(i.quantity) <= Number(i.min_stock));
    } else if (activeFilter === 'expiring') {
        filtered = filtered.filter(i => {
            const d = getDaysUntilExpiry(i.expiry_date);
            return d !== null && d <= 7;
        });
    } else if (activeFilter !== 'all') {
        filtered = filtered.filter(i => i.category === activeFilter);
    }

    if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(i => i.name.toLowerCase().includes(q));
    }

    container.innerHTML = '';

    if (filtered.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 2rem 0;">No hay suministros en esta vista.</p>`;
        return;
    }

    filtered.forEach(item => {
        const isLow = Number(item.quantity) <= Number(item.min_stock);
        const daysLeft = getDaysUntilExpiry(item.expiry_date);
        let expiryBadge = '';
        if (daysLeft !== null) {
            const expColor = daysLeft <= 3 ? 'var(--danger-color, #ef4444)' : daysLeft <= 7 ? 'var(--warning-color, #f59e0b)' : 'var(--text-muted)';
            expiryBadge = `<span style="font-size: 0.74rem; color: ${expColor}; margin-left: 8px;">⏳ ${daysLeft < 0 ? 'Vencido' : `Vence en ${daysLeft}d`}</span>`;
        }

        const row = document.createElement('div');
        row.className = 'setting-row';
        row.style.cssText = `margin-bottom: 0; padding: 0.9rem 1.2rem; border-left: 4px solid ${isLow ? 'var(--warning-color, #f59e0b)' : 'var(--primary-neon)'};`;

        row.innerHTML = `
            <div class="setting-info">
                <h4 style="font-size: 0.96rem; color: var(--text-main); margin-bottom: 2px;">
                    ${escapeHTML(item.name)}
                    ${item.household_id ? '<span style="font-size: 0.68rem; padding: 2px 6px; border-radius: 6px; background: var(--bg-color); color: var(--primary-neon); margin-left: 6px;">🏠 Hogar</span>' : ''}
                </h4>
                <p style="font-size: 0.78rem; color: var(--text-muted); margin: 0;">
                    ${escapeHTML(item.category)} • Mínimo: ${Number(item.min_stock)} ${escapeHTML(item.unit)}
                    ${expiryBadge}
                </p>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <button type="button" class="btn-outline btn-qty-minus" style="padding: 4px 10px;">−</button>
                <span style="min-width: 65px; text-align: center; font-weight: 800; font-size: 0.95rem;">
                    ${Number(item.quantity)} <small style="font-weight: 400; color: var(--text-muted);">${escapeHTML(item.unit)}</small>
                </span>
                <button type="button" class="btn-outline btn-qty-plus" style="padding: 4px 10px;">+</button>
                <button type="button" class="btn-outline btn-del-item" style="padding: 4px 8px; border-color: transparent; color: var(--danger-color, #ef4444);">✕</button>
            </div>
        `;

        const updateQty = async (newQty) => {
            const cleanQty = Math.max(0, newQty);
            const autoShop = cleanQty <= Number(item.min_stock);
            const { error } = await supabase
                .from('inventory_items')
                .update({ quantity: cleanQty, in_shopping_list: autoShop })
                .eq('id', item.id);

            if (!error) {
                item.quantity = cleanQty;
                item.in_shopping_list = autoShop;
                renderInventoryAndKPIs();
            }
        };

        row.querySelector('.btn-qty-minus').addEventListener('click', () => updateQty(Number(item.quantity) - 1));
        row.querySelector('.btn-qty-plus').addEventListener('click', () => updateQty(Number(item.quantity) + 1));

        row.querySelector('.btn-del-item').addEventListener('click', async () => {
            await supabase.from('inventory_items').delete().eq('id', item.id);
            allItems = allItems.filter(i => i.id !== item.id);
            renderInventoryAndKPIs();
            showToast('Producto eliminado de la despensa', 'info');
        });

        container.appendChild(row);
    });
}

function bindInventoryEvents() {
    const form = document.getElementById('inventoryItemForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('invNameInput')?.value.trim();
            const category = document.getElementById('invCategorySelect')?.value;
            const unit = document.getElementById('invUnitSelect')?.value;
            const quantity = Number(document.getElementById('invQtyInput')?.value || 0);
            const minStock = Number(document.getElementById('invMinStockInput')?.value || 1);
            const expiry = document.getElementById('invExpiryInput')?.value || null;
            const manualShop = document.getElementById('invShoppingCheck')?.checked;

            if (!name) return;

            const { error } = await supabase.from('inventory_items').insert({
                user_id: currentUser.id,
                household_id: activeHousehold ? activeHousehold.id : null,
                name,
                category,
                unit,
                quantity,
                min_stock: minStock,
                expiry_date: expiry,
                in_shopping_list: manualShop || quantity <= minStock
            });

            if (error) {
                showToast('Error guardando producto: ' + error.message, 'error');
            } else {
                form.reset();
                showToast('Producto sincronizado en la despensa', 'success');
                await loadInventory();
            }
        });
    }

    // Puente Despensa -> Finanzas (Hogar o Personal)
    const btnCheckout = document.getElementById('btnCheckoutToFinance');
    if (btnCheckout) {
        btnCheckout.addEventListener('click', async () => {
            const shopping = allItems.filter(i => i.in_shopping_list || Number(i.quantity) <= Number(i.min_stock));
            if (shopping.length === 0) return;

            const totalCost = Number(document.getElementById('checkoutTotalInput')?.value || 0);

            for (const item of shopping) {
                const restockedQty = Math.max(Number(item.quantity) + 1, Number(item.min_stock) + 2);
                await supabase
                    .from('inventory_items')
                    .update({ quantity: restockedQty, in_shopping_list: false })
                    .eq('id', item.id);
            }

            if (totalCost > 0) {
                const { error: finErr } = await supabase.from('finance_transactions').insert({
                    user_id: currentUser.id,
                    household_id: activeHousehold ? activeHousehold.id : null,
                    author_name: currentAuthorName,
                    title: `Compra de Despensa (${shopping.length} productos)`,
                    amount: totalCost,
                    type: 'gasto',
                    category: 'Alimentación',
                    is_recurring: false,
                    transaction_date: new Date().toISOString().slice(0, 10)
                });
                if (finErr) console.error('Error registrando compra en finanzas:', finErr);
            }

            document.getElementById('checkoutTotalInput').value = '';
            showToast('Despensa abastecida y gasto registrado en Finanzas', 'success');
            await loadInventory();
        });
    }

    document.getElementById('btnCopyShoppingList')?.addEventListener('click', () => {
        const shopping = allItems.filter(i => i.in_shopping_list || Number(i.quantity) <= Number(i.min_stock));
        if (shopping.length === 0) {
            showToast('La lista de compras está vacía', 'info');
            return;
        }
        const text = `🛒 Lista de Compras (${activeHousehold?.name || 'NGN'}):\n` +
            shopping.map(i => `- ${i.name} (Actual: ${i.quantity} ${i.unit})`).join('\n');
        navigator.clipboard.writeText(text);
        showToast('Lista copiada al portapapeles', 'success');
    });

    document.querySelectorAll('.inv-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.inv-filter-btn').forEach(b => {
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            btn.style.borderColor = 'var(--primary-neon)';
            btn.style.color = 'var(--primary-neon)';
            activeFilter = btn.dataset.filter;
            renderMainInventoryList();
        });
    });

    document.getElementById('invSearchInput')?.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderMainInventoryList();
    });
}