// public/js/controllers/inventory.controller.js
import { supabase } from '../config/supabase.js';
import { navigateTo } from '../core/router.js';
import { showToast } from '../ui/toast.js';
import { getActiveHousehold } from '../core/household.js';
import { escapeHTML, formatCOP } from '../services/finance.service.js';
import { createAgendaItem, getTodayISO } from '../services/agenda.service.js';

const PRICE_CACHE_KEY = 'ngn_inventory_unit_prices_v1';

let currentUser = null;
let currentAuthorName = 'Miembro';
let activeHousehold = null;
let allItems = [];
let activeFilter = 'all';
let searchQuery = '';

function loadPriceCatalog() {
    try {
        return JSON.parse(localStorage.getItem(PRICE_CACHE_KEY) || '{}');
    } catch {
        return {};
    }
}

function saveItemPrice(name, price) {
    const cleanPrice = Number(price || 0);
    if (!name || cleanPrice <= 0) return;
    const map = loadPriceCatalog();
    map[name.trim().toLowerCase()] = cleanPrice;
    localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(map));
}

function getItemEstimatedPrice(name) {
    if (!name) return 0;
    const map = loadPriceCatalog();
    return Number(map[name.trim().toLowerCase()] || 0);
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
    const meta = user.user_metadata || {};
    currentAuthorName = meta.nickname || meta.full_name?.split(' ')[0] || user.email.split('@')[0];

    activeHousehold = await getActiveHousehold(user.id);
    populateCheckoutSourceSelect();

    bindInventoryEvents();
    await loadInventory();
}

function populateCheckoutSourceSelect() {
    const sel = document.getElementById('checkoutSourceSelect');
    if (!sel) return;
    sel.innerHTML = `<option value="personal">👤 Cargar a Flujo Personal</option>`;
    if (activeHousehold) {
        sel.innerHTML += `<option value="household" selected>🏠 Cargar a Hogar (${escapeHTML(activeHousehold.name)})</option>`;
    }
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

function computeShoppingEstimate(shoppingItems) {
    return shoppingItems.reduce((acc, item) => {
        const unitPrice = getItemEstimatedPrice(item.name);
        if (unitPrice <= 0) return acc;
        const needed = Math.max(1, Math.ceil(Number(item.min_stock) - Number(item.quantity) + 1));
        return acc + (unitPrice * needed);
    }, 0);
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
    const estTotalEl = document.getElementById('shoppingEstimatedTotal');

    if (badge) badge.textContent = `${shoppingItems.length} ítems`;
    if (!sideContainer) return;

    if (shoppingItems.length === 0) {
        sideContainer.innerHTML = `<p style="color: var(--text-muted); font-size: 0.82rem; margin: 0;">Todo abastecido. No hay compras urgentes.</p>`;
        if (checkoutBox) checkoutBox.style.display = 'none';
        return;
    }

    if (checkoutBox) checkoutBox.style.display = 'flex';
    const estTotal = computeShoppingEstimate(shoppingItems);
    if (estTotalEl) {
        estTotalEl.textContent = estTotal > 0 ? `~${formatCOP(estTotal)}` : 'Sin precios ref.';
    }

    sideContainer.innerHTML = shoppingItems.map(item => {
        const price = getItemEstimatedPrice(item.name);
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 6px 10px; background: var(--bg-color); border-radius: 10px; border: 1px solid var(--border-card);">
                <div style="overflow: hidden;">
                    <div style="font-size: 0.83rem; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(item.name)}</div>
                    ${price > 0 ? `<div style="font-size: 0.7rem; color: var(--primary-neon);">Ref: ${formatCOP(price)} / ${escapeHTML(item.unit)}</div>` : ''}
                </div>
                <span style="font-size: 0.74rem; color: var(--warning-color, #f59e0b); white-space: nowrap;">Quedan: ${Number(item.quantity)} ${escapeHTML(item.unit)}</span>
            </div>
        `;
    }).join('');
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
        const unitPrice = getItemEstimatedPrice(item.name);

        let expiryBadge = '';
        if (daysLeft !== null) {
            const expColor = daysLeft <= 3 ? 'var(--danger-color, #ef4444)' : daysLeft <= 7 ? 'var(--warning-color, #f59e0b)' : 'var(--text-muted)';
            expiryBadge = `<span style="font-size: 0.74rem; color: ${expColor}; margin-left: 8px;">⏳ ${daysLeft < 0 ? 'Vencido' : `Vence en ${daysLeft}d`}</span>`;
        }

        const priceBadge = unitPrice > 0
            ? `<span style="font-size: 0.72rem; color: var(--primary-neon); margin-left: 8px;">💵 ~${formatCOP(unitPrice)}</span>`
            : '';

        const row = document.createElement('div');
        row.className = 'setting-row';
        row.style.cssText = `margin-bottom: 0; padding: 0.9rem 1.2rem; border-left: 4px solid ${isLow ? 'var(--warning-color, #f59e0b)' : 'var(--primary-neon)'};`;

        row.innerHTML = `
            <div class="setting-info">
                <h4 style="font-size: 0.96rem; color: var(--text-main); margin-bottom: 2px;">
                    ${escapeHTML(item.name)}
                    ${item.household_id ? '<span style="font-size: 0.68rem; padding: 2px 6px; border-radius: 6px; background: var(--bg-color); color: var(--primary-neon); margin-left: 6px;">🏠 Hogar</span>' : ''}
                    ${priceBadge}
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
            const cleanQty = Math.max(0, Number(newQty.toFixed(2)));
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
            const estPrice = Number(document.getElementById('invEstPriceInput')?.value || 0);
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
                if (estPrice > 0) saveItemPrice(name, estPrice);
                form.reset();
                showToast('Producto sincronizado en la despensa', 'success');
                await loadInventory();
            }
        });
    }

    // Puente Despensa -> Finanzas con selector Personal / Hogar y nature: 'operativo'
    const btnCheckout = document.getElementById('btnCheckoutToFinance');
    if (btnCheckout) {
        btnCheckout.addEventListener('click', async () => {
            const shopping = allItems.filter(i => i.in_shopping_list || Number(i.quantity) <= Number(i.min_stock));
            if (shopping.length === 0) return;

            const inputCost = Number(document.getElementById('checkoutTotalInput')?.value || 0);
            const estCost = computeShoppingEstimate(shopping);
            const finalCost = inputCost > 0 ? inputCost : estCost;
            const srcVal = document.getElementById('checkoutSourceSelect')?.value || 'personal';
            const targetHouseholdId = (srcVal === 'household' && activeHousehold) ? activeHousehold.id : null;

            btnCheckout.disabled = true;
            try {
                await Promise.all(shopping.map(item => {
                    const restockedQty = Math.max(Number(item.quantity) + 1, Number(item.min_stock) + 2);
                    return supabase
                        .from('inventory_items')
                        .update({ quantity: restockedQty, in_shopping_list: false })
                        .eq('id', item.id);
                }));

                if (finalCost > 0) {
                    const namesPreview = shopping.slice(0, 3).map(i => i.name).join(', ');
                    const more = shopping.length > 3 ? ` (+${shopping.length - 3})` : '';
                    const { error: finErr } = await supabase.from('finance_transactions').insert({
                        user_id: currentUser.id,
                        household_id: targetHouseholdId,
                        author_name: currentAuthorName,
                        title: `Mercado Despensa: ${namesPreview}${more}`,
                        amount: finalCost,
                        type: 'gasto',
                        nature: 'operativo',
                        category: 'Alimentación',
                        is_recurring: false,
                        transaction_date: getTodayISO()
                    });
                    if (finErr) throw finErr;
                }

                document.getElementById('checkoutTotalInput').value = '';
                const srcLabel = targetHouseholdId ? 'Hogar Familiar' : 'Flujo Personal';
                showToast(
                    finalCost > 0
                        ? `Despensa abastecida y gasto de ${formatCOP(finalCost)} cargado a ${srcLabel}.`
                        : 'Despensa abastecida correctamente.',
                    'success'
                );
                await loadInventory();
            } catch (err) {
                showToast('Error al abastecer despensa: ' + err.message, 'error');
            } finally {
                btnCheckout.disabled = false;
            }
        });
    }

    // Puente Despensa -> Centro de Agendas
    const btnSchedule = document.getElementById('btnScheduleShoppingAgenda');
    if (btnSchedule) {
        btnSchedule.addEventListener('click', async () => {
            const shopping = allItems.filter(i => i.in_shopping_list || Number(i.quantity) <= Number(i.min_stock));
            if (shopping.length === 0) return;

            const srcVal = document.getElementById('checkoutSourceSelect')?.value || 'personal';
            const targetHouseholdId = (srcVal === 'household' && activeHousehold) ? activeHousehold.id : null;
            const estCost = computeShoppingEstimate(shopping);
            const itemsSummary = shopping.slice(0, 5).map(i => i.name).join(', ') + (shopping.length > 5 ? ` (+${shopping.length - 5} más)` : '');

            btnSchedule.disabled = true;
            try {
                await createAgendaItem({
                    user_id: currentUser.id,
                    household_id: targetHouseholdId,
                    author_name: currentAuthorName,
                    assigned_to: targetHouseholdId ? 'Todos' : 'Personal',
                    title: `🛒 Comprar Despensa (${shopping.length} ítems)`,
                    description: `Lista: ${itemsSummary}`,
                    item_type: 'tarea',
                    priority: 'alta',
                    due_date: getTodayISO(),
                    status: 'pendiente',
                    color_tag: '#f59e0b',
                    amount: estCost > 0 ? estCost : null
                });
                showToast('Compra de despensa programada en tu Centro de Agendas.', 'success');
            } catch (err) {
                showToast('Error al agendar compra: ' + err.message, 'error');
            } finally {
                btnSchedule.disabled = false;
            }
        });
    }

    document.getElementById('btnCopyShoppingList')?.addEventListener('click', () => {
        const shopping = allItems.filter(i => i.in_shopping_list || Number(i.quantity) <= Number(i.min_stock));
        if (shopping.length === 0) {
            showToast('La lista de compras está vacía', 'info');
            return;
        }
        const estCost = computeShoppingEstimate(shopping);
        const header = `🛒 Lista de Compras (${activeHousehold?.name || 'NGN'})${estCost > 0 ? ` — Est. ${formatCOP(estCost)}` : ''}:\n`;
        const text = header + shopping.map(i => {
            const p = getItemEstimatedPrice(i.name);
            return `- ${i.name} (Quedan: ${i.quantity} ${i.unit}${p > 0 ? ` • ~${formatCOP(p)}` : ''})`;
        }).join('\n');
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