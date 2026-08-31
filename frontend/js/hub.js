document.addEventListener('DOMContentLoaded', () => {
  const sessionBadge = document.getElementById('sessionBadge');
  const toast = document.getElementById('soonToast');

  /* ----------------------------------------------------------------- */
  /* Sesión: si no hay sesión activa, regresa al login                  */
  /* ----------------------------------------------------------------- */
  const isLoggedIn = localStorage.getItem('auth_session') === 'activo';
  const userEmail = localStorage.getItem('userEmail');

  if (!isLoggedIn) {
    window.location.href = 'login.html?next=hub.html';
    return;
  }

  if (sessionBadge) {
    sessionBadge.innerHTML = '● ' + (userEmail || 'Sesión activa') + ' <a href="#" id="logoutLink">salir</a>';
    const logoutLink = document.getElementById('logoutLink');
    if (logoutLink) {
      logoutLink.addEventListener('click', (e) => {
        e.preventDefault();
        localStorage.removeItem('auth_session');
        localStorage.removeItem('userEmail');
        localStorage.removeItem('geosteam_token');
        window.location.href = 'login.html';
      });
    }
  }

  /* ----------------------------------------------------------------- */
  /* Mostrar la tarjeta "Panel de administrador" solo a usuarios admin  */
  /* ----------------------------------------------------------------- */
  const API_BASE = window.GEOSTEAM_API_BASE || 'http://localhost:8001';
  const token = localStorage.getItem('geosteam_token');
  const adminCardWrap = document.getElementById('adminCardWrap');

  if (token && adminCardWrap) {
    fetch(API_BASE + '/api/me', { headers: { 'Authorization': 'Bearer ' + token } })
      .then((res) => (res.ok ? res.json() : null))
      .then((user) => {
        if (user && user.role === 'admin') {
          adminCardWrap.classList.remove('d-none');
        }
      })
      .catch(() => {});
  }

  /* ----------------------------------------------------------------- */
  /* Tarjetas "próximamente": muestran un aviso en vez de navegar       */
  /* ----------------------------------------------------------------- */
  let toastTimer = null;

  document.querySelectorAll('.hub-card--soon').forEach((card) => {
    card.addEventListener('click', () => {
      const nombre = card.getAttribute('data-soon') || 'Esta sección';
      mostrarToast(`${nombre} estará disponible próximamente.`);
    });
  });

  function mostrarToast(mensaje) {
    if (!toast) return;
    toast.textContent = mensaje;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
});
