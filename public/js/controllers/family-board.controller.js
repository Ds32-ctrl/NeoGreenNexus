// public/js/controllers/family-board.controller.js
import { supabase } from '../config/supabase.js';
import { navigateTo } from '../core/router.js';
import { showToast } from '../ui/toast.js';

const CATEGORY_LABELS = {
    nota:   { icon: '📌', label: 'Nota Visual' },
    alerta: { icon: '🚨', label: 'Alerta Urgente' },
    evento: { icon: '📅', label: 'Evento' },
    tarea:  { icon: '✅', label: 'Tarea' }
};

let currentUser = null;
let allPosts = [];
let activeCategory = 'all';
let searchQuery = '';
let selectedColor = '#10b981';

export async function initFamilyBoard() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        navigateTo('/');
        return;
    }
    currentUser = user;
    selectedColor = '#10b981';

    bindBoardEvents();
    await loadBoardPosts();
}

async function loadBoardPosts() {
    try {
        const { data, error } = await supabase
            .from('family_board_posts')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('pinned', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) throw error;

        allPosts = data || [];
        updateCountersAndAgenda();
        renderBoardGrid();
    } catch (error) {
        console.error('Error cargando Tablero Compartido:', error);
        showToast('No se pudieron cargar las notas del tablero', 'error');
    }
}

function updateCountersAndAgenda() {
    const pinnedCountEl = document.getElementById('boardPinnedCount');
    const totalCountEl = document.getElementById('boardTotalCount');
    const upcomingList = document.getElementById('upcomingEventsList');

    const pinnedCount = allPosts.filter(p => p.pinned).length;
    if (pinnedCountEl) pinnedCountEl.textContent = pinnedCount;
    if (totalCountEl) totalCountEl.textContent = allPosts.length;

    if (!upcomingList) return;
    const events = allPosts
        .filter(p => p.event_date)
        .sort((a, b) => new Date(a.event_date) - new Date(b.event_date))
        .slice(0, 5);

    if (events.length === 0) {
        upcomingList.innerHTML = `<p style="color: var(--text-muted); font-size: 0.82rem; margin: 0;">Sin eventos programados.</p>`;
        return;
    }

    upcomingList.innerHTML = events.map(ev => {
        const dateStr = new Date(ev.event_date).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--bg-color); border-radius: 10px; border-left: 3px solid ${ev.color_tag || 'var(--primary-neon)'};">
                <span style="font-size: 0.83rem; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;">${ev.title}</span>
                <span style="font-size: 0.75rem; color: var(--primary-neon); font-weight: 700;">${dateStr}</span>
            </div>
        `;
    }).join('');
}

function renderBoardGrid() {
    const grid = document.getElementById('boardPostsGrid');
    if (!grid) return;

    let filtered = allPosts;

    if (activeCategory !== 'all') {
        filtered = filtered.filter(p => p.category === activeCategory);
    }

    if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(p =>
            (p.title && p.title.toLowerCase().includes(q)) ||
            (p.content && p.content.toLowerCase().includes(q))
        );
    }

    grid.innerHTML = '';

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; border: 1px dashed var(--border-card); border-radius: 18px; color: var(--text-muted);">
                <p style="font-size: 0.98rem; margin-bottom: 0.3rem;">No hay notas ni avisos en esta vista.</p>
                <span style="font-size: 0.82rem;">Usa el panel izquierdo para publicar una nota visual, tarea o evento en el mural.</span>
            </div>
        `;
        return;
    }

    filtered.forEach(post => {
        const catInfo = CATEGORY_LABELS[post.category] || CATEGORY_LABELS.nota;
        const accent = post.color_tag || '#10b981';
        const createdDate = new Date(post.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
        const eventBadge = post.event_date
            ? `<div style="margin-top: 10px; display: inline-flex; align-items: center; gap: 5px; font-size: 0.76rem; padding: 3px 9px; border-radius: 8px; background: var(--panel-bg); border: 1px solid var(--border-card); color: var(--text-main);">
                 📅 Programado: <strong>${new Date(post.event_date).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
               </div>`
            : '';

        const card = document.createElement('div');
        card.style.cssText = `
            background: var(--bg-color);
            border: 1px solid var(--border-card);
            border-top: 4px solid ${accent};
            border-radius: 18px;
            padding: 1.3rem;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            box-shadow: var(--shadow-base);
            transition: var(--transition-smooth);
            position: relative;
        `;

        card.innerHTML = `
            <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem;">
                    <span style="font-size: 0.74rem; font-weight: 700; text-transform: uppercase; color: ${accent}; display: flex; align-items: center; gap: 4px;">
                        ${catInfo.icon} ${catInfo.label}
                    </span>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <button type="button" class="btn-pin-post" title="${post.pinned ? 'Desfijar' : 'Fijar arriba'}" style="background: transparent; border: none; cursor: pointer; font-size: 0.95rem; opacity: ${post.pinned ? '1' : '0.35'};">
                            📌
                        </button>
                        <button type="button" class="btn-delete-post" title="Eliminar publicación" style="background: transparent; border: none; cursor: pointer; color: var(--danger-color); font-size: 0.9rem;">
                            ✕
                        </button>
                    </div>
                </div>
                <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--text-main); margin-bottom: 0.4rem;">${post.title}</h4>
                <p style="font-size: 0.9rem; color: var(--text-muted); line-height: 1.5; white-space: pre-wrap;">${post.content}</p>
                ${eventBadge}
            </div>
            <div style="margin-top: 1.2rem; padding-top: 0.7rem; border-top: 1px solid var(--border-card); display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: var(--text-muted);">
                <span>Publicado: ${createdDate}</span>
                ${post.pinned ? `<span style="color: ${accent}; font-weight: 700;">★ Fijado</span>` : ''}
            </div>
        `;

        // Fijar / Desfijar publicación
        card.querySelector('.btn-pin-post').addEventListener('click', async () => {
            const newPinned = !post.pinned;
            const { error } = await supabase
                .from('family_board_posts')
                .update({ pinned: newPinned })
                .eq('id', post.id);

            if (!error) {
                showToast(newPinned ? 'Aviso fijado en la parte superior' : 'Aviso desfijado', 'info');
                await loadBoardPosts();
            }
        });

        // Eliminar publicación
        card.querySelector('.btn-delete-post').addEventListener('click', async () => {
            const { error } = await supabase
                .from('family_board_posts')
                .delete()
                .eq('id', post.id);

            if (!error) {
                allPosts = allPosts.filter(p => p.id !== post.id);
                updateCountersAndAgenda();
                renderBoardGrid();
                showToast('Publicación eliminada del tablero', 'info');
            }
        });

        grid.appendChild(card);
    });
}

function bindBoardEvents() {
    // 1. Selector de color de tarjeta
    const colorBtns = document.querySelectorAll('.color-tag-btn');
    colorBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            colorBtns.forEach(b => b.style.borderColor = 'transparent');
            btn.style.borderColor = 'var(--text-main)';
            selectedColor = btn.dataset.color;
        });
    });

    // 2. Publicar nueva nota / alerta / evento
    const postForm = document.getElementById('boardPostForm');
    if (postForm) {
        postForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const titleInput = document.getElementById('postTitleInput');
            const contentInput = document.getElementById('postContentInput');
            const categorySelect = document.getElementById('postCategorySelect');
            const eventDateInput = document.getElementById('postEventDate');
            const pinnedCheck = document.getElementById('postPinnedCheck');

            const title = titleInput.value.trim();
            const content = contentInput.value.trim();
            if (!title || !content) return;

            const eventDate = eventDateInput.value ? new Date(eventDateInput.value + 'T12:00:00').toISOString() : null;

            const { error } = await supabase.from('family_board_posts').insert({
                user_id: currentUser.id,
                title,
                content,
                category: categorySelect.value,
                color_tag: selectedColor,
                pinned: pinnedCheck.checked,
                event_date: eventDate
            });

            if (error) {
                showToast('Error al publicar: ' + error.message, 'error');
            } else {
                titleInput.value = '';
                contentInput.value = '';
                eventDateInput.value = '';
                pinnedCheck.checked = false;
                showToast('Nota publicada en el Tablero Compartido', 'success');
                await loadBoardPosts();
            }
        });
    }

    // 3. Filtros por categoría
    document.querySelectorAll('.board-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.board-filter-btn').forEach(b => {
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            btn.style.borderColor = 'var(--primary-neon)';
            btn.style.color = 'var(--primary-neon)';
            activeCategory = btn.dataset.category;
            renderBoardGrid();
        });
    });

    // 4. Búsqueda instantánea por texto
    const searchInput = document.getElementById('boardSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            renderBoardGrid();
        });
    }
}