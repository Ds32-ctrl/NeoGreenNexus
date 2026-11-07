// public/js/ui/modal.js
import { supabase } from '../config/supabase.js';
import { navigateTo } from '../core/router.js';
import { checkActiveSession } from '../core/auth.js';
import { showToast } from './toast.js';

let isRegisterMode = false;
let selectedRegisterAvatar = 'https://api.dicebear.com/7.x/bottts-neutral/svg?seed=N1&backgroundColor=e2e8f0';

export async function openLoginModal() {
    const modalContainer = document.getElementById('modalContainer');
    if (!modalContainer) return;

    try {
        if (!modalContainer.innerHTML.trim()) {
            const response = await fetch('/views/login.html');
            if (!response.ok) throw new Error('Error al cargar /views/login.html');
            modalContainer.innerHTML = await response.text();
            initModalLogic(modalContainer);
        }
        modalContainer.classList.add('show');
        modalContainer.setAttribute('aria-hidden', 'false');
    } catch (error) {
        console.error(error);
        showToast('No se pudo abrir la ventana de acceso', 'error');
    }
}

export function closeLoginModal() {
    const modalContainer = document.getElementById('modalContainer');
    if (!modalContainer) return;
    modalContainer.classList.remove('show');
    modalContainer.setAttribute('aria-hidden', 'true');
}

function initModalLogic(container) {
    // 1. Cerrar modal
    container.addEventListener('click', (e) => {
        if (e.target === container || e.target.closest('#closeModal')) {
            closeLoginModal();
        }
    });

    // 2. Poblar selectores de Fecha (Día, Mes, Año)
    const daySelect = container.querySelector('#regDay');
    const monthSelect = container.querySelector('#regMonth');
    const yearSelect = container.querySelector('#regYear');

    if (daySelect && monthSelect && yearSelect) {
        for (let d = 1; d <= 31; d++) {
            daySelect.innerHTML += `<option value="${d}">${d}</option>`;
        }
        const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        months.forEach((m, idx) => {
            monthSelect.innerHTML += `<option value="${idx + 1}">${m}</option>`;
        });
        const currentYear = new Date().getFullYear();
        for (let y = currentYear - 10; y >= 1940; y--) {
            yearSelect.innerHTML += `<option value="${y}">${y}</option>`;
        }
    }

    // 3. Selección de avatar en registro
    const avatarOptions = container.querySelectorAll('.avatar-option');
    avatarOptions.forEach(img => {
        img.addEventListener('click', () => {
            avatarOptions.forEach(a => a.style.borderColor = 'transparent');
            img.style.borderColor = 'var(--primary-neon)';
            selectedRegisterAvatar = img.getAttribute('data-url');
        });
    });

    // 4. Alternar entre Iniciar Sesión y Crear Cuenta
    const toggleBtn = container.querySelector('#toggleAuthMode');
    const toggleText = container.querySelector('#toggleText');
    const authTitle = container.querySelector('#authTitle');
    const authSubtitle = container.querySelector('#authSubtitle');
    const extraFields = container.querySelector('#extraRegisterFields');
    const btnSubmit = container.querySelector('#btnSubmitAuth');

    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            isRegisterMode = !isRegisterMode;
            if (isRegisterMode) {
                authTitle.textContent = 'Crear Cuenta';
                authSubtitle.textContent = 'Configura tu nodo personal en la red.';
                extraFields.style.display = 'block';
                btnSubmit.textContent = 'Registrarme';
                toggleText.textContent = '¿Ya tienes un nodo activo?';
                toggleBtn.textContent = 'Iniciar sesión';
            } else {
                authTitle.textContent = 'Iniciar Sesión';
                authSubtitle.textContent = 'Accede a tu entorno personal.';
                extraFields.style.display = 'none';
                btnSubmit.textContent = 'Ingresar';
                toggleText.textContent = '¿Aún no eres parte?';
                toggleBtn.textContent = 'Crear cuenta';
            }
        });
    }

    // 5. Enviar Login o Registro a Supabase
    if (btnSubmit) {
        btnSubmit.addEventListener('click', async () => {
            const email = container.querySelector('#loginEmail')?.value.trim();
            const password = container.querySelector('#loginPassword')?.value;

            if (!email || !password) {
                showToast('Completa tu correo y contraseña', 'error');
                return;
            }

            if (password.length < 6) {
                showToast('La contraseña debe tener al menos 6 caracteres', 'error');
                return;
            }

            btnSubmit.disabled = true;
            btnSubmit.style.opacity = '0.7';

            try {
                if (isRegisterMode) {
                    const fullName = container.querySelector('#regName')?.value.trim() || 'Usuario NGN';
                    
                    // Formatear fecha a YYYY-MM-DD para PostgreSQL
                    let birthDate = null;
                    if (daySelect?.value && monthSelect?.value && yearSelect?.value) {
                        const mm = String(monthSelect.value).padStart(2, '0');
                        const dd = String(daySelect.value).padStart(2, '0');
                        birthDate = `${yearSelect.value}-${mm}-${dd}`;
                    }

                    const { data, error } = await supabase.auth.signUp({
                        email,
                        password,
                        options: {
                            data: {
                                full_name: fullName,
                                avatar_url: selectedRegisterAvatar,
                                birth_date: birthDate
                            }
                        }
                    });

                    if (error) throw error;

                    // Si Confirm Email está desactivado, entra directo al Dashboard
                    if (data?.session) {
                        closeLoginModal();
                        await checkActiveSession();
                        showToast('¡Nodo creado! Bienvenido a NeoGreenNexus', 'success');
                        navigateTo('/views/dashboard.html');
                    } else {
                        showToast('Cuenta creada. Revisa tu correo para confirmar el acceso.', 'info');
                    }
                } else {
                    const { error } = await supabase.auth.signInWithPassword({ email, password });
                    if (error) throw error;

                    closeLoginModal();
                    await checkActiveSession();
                    showToast('Bienvenido a NeoGreenNexus', 'success');
                    navigateTo('/views/dashboard.html');
                }
            } catch (error) {
                showToast(error.message || 'Error de autenticación', 'error');
            } finally {
                btnSubmit.disabled = false;
                btnSubmit.style.opacity = '1';
            }
        });
    }

    // 6. Autenticación con Google OAuth
    const btnGoogle = container.querySelector('#btnGoogleAuth');
    if (btnGoogle) {
        btnGoogle.addEventListener('click', async () => {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: window.location.origin }
            });
            if (error) showToast(error.message, 'error');
        });
    }
}