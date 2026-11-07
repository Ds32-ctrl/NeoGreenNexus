// public/js/core/router.js
import { initDashboard } from '../controllers/dashboard.controller.js';
import { initSettings } from '../controllers/settings.controller.js';

const viewControllers = {
  '/views/dashboard.html': initDashboard,
  '/views/settings.html': initSettings,
};

export async function loadNode(encodedString) {
  const mainContent = document.getElementById('main-content');
  const dynamicView = document.getElementById('dynamic-view');

  try {
    const decodedPath = atob(encodedString);
    const fetchPath = decodedPath.startsWith('/') ? decodedPath : `/${decodedPath}`;

    const response = await fetch(fetchPath);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    dynamicView.innerHTML = await response.text();
    mainContent.style.display = 'none';
    dynamicView.style.display = 'block';
    window.scrollTo(0, 0);

    // Si la vista tiene un controlador asociado, lo ejecutamos limpiamente
    if (viewControllers[fetchPath]) {
      await viewControllers[fetchPath]();
    }
  } catch (error) {
    console.error('Error del enrutador:', error);
    mainContent.style.display = 'block';
    dynamicView.style.display = 'none';
    history.pushState(null, '', '/');
  }
}