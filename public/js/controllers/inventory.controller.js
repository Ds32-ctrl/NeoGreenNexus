// public/js/controllers/inventory.controller.js
import { supabase } from '../config/supabase.js';
import { navigateTo } from '../core/router.js';
import { showToast } from '../ui/toast.js';

const CATEGORY_ICONS = {
    'Alimentos':    '🍎',
    'Despensa':     '🥫',
    'Limpieza':     '🧼',
    'Higiene':      '🧴',
    'Herramientas': '🔋'
};

let currentUser = null;
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

export async function initInventory() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        navigateTo('/');
        return;
    }
    currentUser = user;
    activeFilter = 'all';
    searchQuery = '';

    bindInventoryEvents();
    await loadInventoryItems();
}

async function loadInventoryItems() {
    try {
        const { data, error } = await supabase
            .from('inventory_items')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('name', { ascending: true });

        if (error) throw error;

        allItems = data || [];
        updateKPIsAndShoppingList();
        renderInventoryList();
    } catch (error) {
        console.error('Error cargando Despensa Inteligente:', error);
        showToast('Error al cargar el inventario.', 'error');
    }
}

function getDaysUntilExpiry(expiryDateStr) {
    if (!expiryDateStr) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp = new Date(expiryDateStr + 'T00:00:00');
    const diffTime = exp - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function isLowStock(item) {
    return Number(item.quantity) <= Number(item.min_stock);
}

function isExpiringSoon(item) {
    const days = getDaysUntilExpiry(item.expiry_date);
    return days !== null && days <= 7;
}

function updateKPIsAndShoppingList() {
    const totalEl = document.getElementById('invTotalItems');
    const lowEl = document.getElementById('invLowStockCount');
    const expEl = document.getElementById('invExpiringCount');
    const shopEl = document.getElementById('invShoppingCount');
    const sideBadge = document.getElementById('shoppingSideBadge');
    const sideContainer = document.getElementById('shoppingListSideContainer');
    const checkoutBox = document.getElementById('shoppingCheckoutBox');

    const lowStockItems = allItems.filter(isLowStock);
    const expiringItems = allItems.filter(isExpiringSoon);
    const shoppingItems = allItems.filter(i => i.in_shopping_list || isLowStock(i));

    if (totalEl) totalEl.textContent = allItems.length;
    if (lowEl) lowEl.textContent = lowStockItems.length;
    if (expEl) expEl.textContent = expiringItems.length;
    if (shopEl) shopEl.textContent = shoppingItems.length;
    if (sideBadge) sideBadge.textContent = `${shoppingItems.length} ítem(s)`;

    if (!sideContainer) return;
    if (shoppingItems.length === 0) {
        sideContainer.innerHTML = `<p style="color: var(--text-muted); font-size: 0.82rem; margin: 0;">Todo abastecido. No hay compras pendientes.</p>`;
        if (checkoutBox) checkoutBox.style.display = 'none';
        return;
    }

    if (checkoutBox) checkoutBox.style.display = 'block';
    sideContainer.innerHTML = '';

    shoppingItems.forEach(item => {
        const div = document.createElement('div');
        div.style.cssText = `
            display: flex; justify-content: space-between; align-items: center;
            padding: 8px 10px; background: var(--bg-color); border-radius: 10px;
            border-left: 3px solid var(--primary-neon);
        `;
        div.innerHTML = `
            <div style="overflow: hidden;">
                <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(item.name)}</div>
                <div style="font-size: 0.73rem; color: var(--text-muted);">Quedan: ${Number(item.quantity)} ${escapeHTML(item.unit)}</div>
            </div>
            <button type="button" class="btn-outline btn-restock-now" style="padding: 4px 8px; font-size: 0.75rem;" title="Marcar como comprado (+ Stock)">
                ✓ Comprado
            </button>
        `;

        div.querySelector('.btn-restock-now').addEventListener('click', async () => {
            const newQty = Math.max(Number(item.quantity) + 1, Number(item.min_stock) + 2);
            const { error } = await supabase
                .from('inventory_items')
                .update({ quantity: newQty, in_shopping_list: false })
                .eq('id', item.id);

            if (!error) {
                showToast(`"${item.name}" reabastecido en despensa.`, 'success');
                await loadInventoryItems();
            }
        });

        sideContainer.appendChild(div);
    });
}

function renderInventoryList() {
    const container = document.getElementById('inventoryItemsContainer');
    if (!container) return;

    let filtered = allItems;

    if (activeFilter === 'low') {
        filtered = filtered.filter(isLowStock);
    } else if (activeFilter === 'expiring') {
        filtered = filtered.filter(isExpiringSoon);
    } else if (activeFilter !== 'all') {
        filtered = filtered.filter(i => i.category === activeFilter);
    }

    if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(i =>
            (i.name && i.name.toLowerCase().includes(q)) ||
            (i.category && i.category.toLowerCase().includes(q))
        );
    }

    container.innerHTML = '';

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2.5rem 1rem; border: 1px dashed var(--border-card); border-radius: 16px; color: var(--text-muted);">
                <p style="font-size: 0.95rem; margin-bottom: 0.3rem;">No hay suministros en esta vista.</p>
                <span style="font-size: 0.8rem;">Añade tus alimentos o productos de aseo desde el panel izquierdo.</span>
            </div>
        `;
        return;
    }

    filtered.forEach(item => {
        const low = isLowStock(item);
        const daysLeft = getDaysUntilExpiry(item.expiry_date);
        const emoji = CATEGORY_ICONS[item.category] || '📦';

        let expiryBadge = '';
        if (daysLeft !== null) {
            if (daysLeft < 0) {
                expiryBadge = `<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 6px; background: rgba(239,68,68,0.15); color: var(--danger-color, #ef4444); font-weight: 700;">🚨 Vencido (${Math.abs(daysLeft)}d)</span>`;
            } else if (daysLeft <= 3) {
                expiryBadge = `<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 6px; background: rgba(239,68,68,0.15); color: var(--danger-color, #ef4444); font-weight: 700;">⏳ Vence en ${daysLeft}d</span>`;
            } else if (daysLeft <= 7) {
                expiryBadge = `<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 6px; background: rgba(245,158,11,0.15); color: var(--warning-color, #f59e0b); font-weight: 700;">⚠️ Vence en ${daysLeft}d</span>`;
            } else {
                expiryBadge = `<span style="font-size: 0.72rem; color: var(--text-muted);">📅 Vence: ${escapeHTML(item.expiry_date)}</span>`;
            }
        }

        const stockBadge = low
            ? `<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 6px; background: rgba(245,158,11,0.15); color: var(--warning-color, #f59e0b); font-weight: 700;">Stock Bajo</span>`
            : '';

        const row = document.createElement('div');
        row.className = 'setting-row';
        row.style.marginBottom = '0';
        row.style.padding = '0.95rem 1.2rem';
        row.style.borderLeft = `4px solid ${low ? 'var(--warning-color, #f59e0b)' : 'var(--primary-neon)'}`;

        row.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
                <span style="font-size: 1.35rem;">${emoji}</span>
                <div class="setting-info">
                    <h4 style="font-size: 0.98rem; color: var(--text-main); display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        ${escapeHTML(item.name)} ${stockBadge} ${expiryBadge}
                    </h4>
                    <p style="font-size: 0.8rem; color: var(--text-muted);">
                        ${escapeHTML(item.category)} • Mínimo requerido: ${Number(item.min_stock)} ${escapeHTML(item.unit)}
                    </p>
                </div>
            </div>

            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <button type="button" class="btn-outline btn-qty-minus" style="padding: 4px 10px; font-weight: 800;">−</button>
                <span style="min-width: 75px; text-align: center; font-size: 0.95rem; font-weight: 800; color: ${low ? 'var(--warning-color, #f59e0b)' : 'var(--text-main)'};">
                    ${Number(item.quantity)} <small style="font-weight: 500; color: var(--text-muted);">${escapeHTML(item.unit)}</small>
                </span>
                <button type="button" class="btn-outline btn-qty-plus" style="padding: 4px 10px; font-weight: 800;">+</button>

                <button type="button" class="btn-outline btn-toggle-cart" title="Enviar / Quitar de Lista de Compras" style="padding: 5px 9px; border-color: ${item.in_shopping_list ? 'var(--primary-neon)' : 'var(--border-card)'}; color: ${item.in_shopping_list ? 'var(--primary-neon)' : 'var(--text-muted)'};">
                    🛒
                </button>

                <button type="button" class="btn-outline btn-delete-item" title="Eliminar producto" style="border-color: transparent; color: var(--danger-color, #ef4444); padding: 5px 8px;">
                    ✕
                </button>
            </div>
        `;

        // Disminuir cantidad (−)
        row.querySelector('.btn-qty-minus').addEventListener('click', async () => {
            const nextQty = Math.max(0, Number((Number(item.quantity) - 1).toFixed(2)));
            const autoShop = nextQty <= Number(item.min_stock) ? true : item.in_shopping_list;
            const { error } = await supabase
                .from('inventory_items')
                .update({ quantity: nextQty, in_shopping_list: autoShop })
                .eq('id', item.id);

            if (!error) {
                item.quantity = nextQty;
                item.in_shopping_list = autoShop;
                updateKPIsAndShoppingList();
                renderInventoryList();
            }
        });

        // Aumentar cantidad (+)
        row.querySelector('.btn-qty-plus').addEventListener('click', async () => {
            const nextQty = Number((Number(item.quantity) + 1).toFixed(2));
            const autoShop = nextQty > Number(item.min_stock) ? false : item.in_shopping_list;
            const { error } = await supabase
                .from('inventory_items')
                .update({ quantity: nextQty, in_shopping_list: autoShop })
                .eq('id', item.id);

            if (!error) {
                item.quantity = nextQty;
                item.in_shopping_list = autoShop;
                updateKPIsAndShoppingList();
                renderInventoryList();
            }
        });

        // Alternar manualmente en Lista de Compras
        row.querySelector('.btn-toggle-cart').addEventListener('click', async () => {
            const nextShop = !item.in_shopping_list;
            const { error } = await supabase
                .from('inventory_items')
                .update({ in_shopping_list: nextShop })
                .eq('id', item.id);

            if (!error) {
                item.in_shopping_list = nextShop;
                updateKPIsAndShoppingList();
                renderInventoryList();
                showToast(nextShop ? 'Añadido a la lista de compras.' : 'Retirado de la lista de compras.', 'info');
            }
        });

        // Eliminar ítem
        row.querySelector('.btn-delete-item').addEventListener('click', async () => {
            const { error } = await supabase
                .from('inventory_items')
                .delete()
                .eq('id', item.id);

            if (!error) {
                allItems = allItems.filter(i => i.id !== item.id);
                updateKPIsAndShoppingList();
                renderInventoryList();
                showToast('Producto eliminado de la despensa.', 'info');
            }
        });

        container.appendChild(row);
    });
}

function bindInventoryEvents() {
    // 1. Crear Nuevo Producto
    const form = document.getElementById('inventoryItemForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nameInput = document.getElementById('invNameInput');
            const catSelect = document.getElementById('invCategorySelect');
            const unitSelect = document.getElementById('invUnitSelect');
            const qtyInput = document.getElementById('invQtyInput');
            const minInput = document.getElementById('invMinStockInput');
            const expInput = document.getElementById('invExpiryInput');
            const shopCheck = document.getElementById('invShoppingCheck');
            const submitBtn = form.querySelector('button[type="submit"]');

            const name = nameInput.value.trim();
            if (!name) return;

            const qty = parseFloat(qtyInput.value) || 0;
            const minStock = parseFloat(minInput.value) || 1;
            const inShop = shopCheck.checked || qty <= minStock;

            if (submitBtn) submitBtn.disabled = true;

            try {
                const { error } = await supabase.from('inventory_items').insert({
                    user_id: currentUser.id,
                    name,
                    category: catSelect.value,
                    unit: unitSelect.value,
                    quantity: qty,
                    min_stock: minStock,
                    expiry_date: expInput.value || null,
                    in_shopping_list: inShop
                });

                if (error) throw error;

                nameInput.value = '';
                qtyInput.value = '1';
                minInput.value = '1';
                expInput.value = '';
                shopCheck.checked = false;
                showToast(`"${name}" agregado a la despensa.`, 'success');
                await loadInventoryItems();
            } catch (error) {
                showToast('Error al guardar producto: ' + error.message, 'error');
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    // 2. Puente Ecosistémico: Liquidar Lista de Compras y Registrar Gasto en Flujo Financiero
    const btnCheckout = document.getElementById('btnCheckoutToFinance');
    if (btnCheckout) {
        btnCheckout.addEventListener('click', async () => {
            const shoppingItems = allItems.filter(i => i.in_shopping_list || isLowStock(i));
            if (shoppingItems.length === 0) return;

            const costInput = document.getElementById('checkoutTotalInput');
            const totalCost = parseFloat(costInput?.value || 0);
            btnCheckout.disabled = true;

            try {
                // Reabastecer todos los artículos de la lista en paralelo
                await Promise.all(shoppingItems.map(item => {
                    const nextQty = Math.max(Number(item.quantity) + 1, Number(item.min_stock) + 2);
                    return supabase
                        .from('inventory_items')
                        .update({ quantity: nextQty, in_shopping_list: false })
                        .eq('id', item.id);
                }));

                // Si el usuario ingresó un monto, registrarlo automáticamente en finance_transactions
                if (totalCost > 0) {
                    const summaryNames = shoppingItems.slice(0, 3).map(i => i.name).join(', ');
                    const extra = shoppingItems.length > 3 ? ` (+${shoppingItems.length - 3} más)` : '';
                    await supabase.from('finance_transactions').insert({
                        user_id: currentUser.id,
                        title: `Compra Despensa: ${summaryNames}${extra}`,
                        amount: totalCost,
                        type: 'gasto',
                        category: 'Alimentación',
                        is_recurring: false,
                        transaction_date: new Date().toISOString().split('T')[0]
                    });
                    if (costInput) costInput.value = '';
                    showToast(`Despensa abastecida y gasto de $${totalCost.toLocaleString('es-CO')} registrado en Finanzas.`, 'success');
                } else {
                    showToast(`Se reabastecieron ${shoppingItems.length} producto(s) en la despensa.`, 'success');
                }

                await loadInventoryItems();
            } catch (err) {
                showToast('Error al procesar el reabastecimiento: ' + err.message, 'error');
            } finally {
                btnCheckout.disabled = false;
            }
        });
    }

    // 3. Filtros por Categoría / Estado
    document.querySelectorAll('.inv-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.inv-filter-btn').forEach(b => {
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            btn.style.borderColor = 'var(--primary-neon)';
            btn.style.color = 'var(--primary-neon)';
            activeFilter = btn.dataset.filter;
            renderInventoryList();
        });
    });

    // 4. Buscador Instantáneo
    const searchInput = document.getElementById('invSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            renderInventoryList();
        });
    }

    // 5. Copiar Lista de Compras al Portapapeles
    const btnCopy = document.getElementById('btnCopyShoppingList');
    if (btnCopy) {
        btnCopy.addEventListener('click', async () => {
            const shoppingItems = allItems.filter(i => i.in_shopping_list || isLowStock(i));
            if (shoppingItems.length === 0) {
                showToast('No hay productos pendientes en la lista de compras.', 'info');
                return;
            }

            const lines = shoppingItems.map(i => `• ${i.name} (Actual: ${i.quantity} ${i.unit})`);
            const text = `🛒 LISTA DE COMPRAS NGN:\n${lines.join('\n')}`;

            try {
                await navigator.clipboard.writeText(text);
                showToast('Lista de compras copiada al portapapeles.', 'success');
            } catch {
                showToast('No se pudo copiar automáticamente.', 'error');
            }
        });
    }
}