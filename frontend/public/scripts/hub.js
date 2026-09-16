/* ============================================================
   HUB — Sesión, user pill, admin card, toast y mejoras UI
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  const toast     = document.getElementById('soonToast');
  const logoutBtn = document.getElementById('logoutBtn');

  /* -------------------------------------------------------------
     1) SESIÓN — si no hay sesión activa, redirigir al login
     ------------------------------------------------------------- */
  const isLoggedIn = localStorage.getItem('auth_session') === 'activo';
  const userEmail  = localStorage.getItem('userEmail');

  if (!isLoggedIn) {
    window.location.href = '/login?next=/hub';
    return;
  }

  /* -------------------------------------------------------------
     2) USER PILL — pintar datos del usuario en el topbar
     ------------------------------------------------------------- */
  const userInitEl = document.getElementById('userInitial');
  const userNameEl = document.getElementById('userName');
  const userRoleEl = document.getElementById('userRole');

  function pintarUsuario({ nombre, email, rol }) {
    const display = (nombre && nombre.trim())
                 || (email  && email.trim())
                 || 'Usuario';
    const initial = (display.trim()[0] || '·').toUpperCase();

    if (userInitEl) userInitEl.textContent = initial;
    if (userNameEl) userNameEl.textContent = display;
    if (userRoleEl) userRoleEl.textContent = (rol || 'usuario').toLowerCase();
  }

  // Pintado inmediato con lo que haya en localStorage (evita "Cargando…")
  pintarUsuario({
    nombre: localStorage.getItem('userName') || '',
    email:  userEmail || '',
    rol:    localStorage.getItem('userRole') || '',
  });

  /* -------------------------------------------------------------
     3) LOGOUT — botón dedicado + atajo Esc → vuelve al index
     ------------------------------------------------------------- */
  function cerrarSesion() {
    localStorage.removeItem('auth_session');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userName');
    localStorage.removeItem('userRole');
    localStorage.removeItem('geosteam_token');
    window.location.href = '/';          // ← index público
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', cerrarSesion);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarSesion();
  });

 /* -------------------------------------------------------------
   4) /api/me — refrescar datos y mostrar admin si aplica
   ------------------------------------------------------------- */
const API_BASE = window.GEOSTEAM_API_BASE || '';
const token = localStorage.getItem('geosteam_token');
const adminCardWrap = document.getElementById('adminCardWrap');
const adminChip     = document.getElementById('adminChip');

// Helper: ¿es admin según el array de roles?
function esAdmin(roles) {
  return Array.isArray(roles) && roles.includes('ROLE_ADMIN');
}

// --- Pintado inmediato con lo cacheado (evita "Cargando…" y destapa chip ya) ---
(function pintadoInicial() {
  const roles = JSON.parse(localStorage.getItem('userRoles') || '[]');

  pintarUsuario({
    nombre: localStorage.getItem('userName') || '',
    email:  userEmail || '',
    rol:    esAdmin(roles) ? 'admin' : (roles[0] || '').replace('ROLE_', '').toLowerCase(),
  });

  if (esAdmin(roles)) {
    if (adminCardWrap) adminCardWrap.classList.remove('d-none');
    if (adminChip)     adminChip.classList.remove('d-none');
  }
})();

// --- Refresco contra el backend ---
if (token) {
  fetch(API_BASE + '/api/me', {
    headers: { Authorization: 'Bearer ' + token },
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data) return;

      // El backend puede devolver { user: {...} } o directamente el user
      const user  = data.user || data;
      const roles = user.roles || JSON.parse(localStorage.getItem('userRoles') || '[]');

      pintarUsuario({
        nombre: user.full_name || user.nombre || user.name || user.username || '',
        email:  user.email || userEmail || '',
        rol:    esAdmin(roles) ? 'admin' : (roles[0] || 'usuario').replace('ROLE_', '').toLowerCase(),
      });

      // Cache para la próxima carga
      const nombreCache = user.full_name || user.nombre;
      if (nombreCache) localStorage.setItem('userName', nombreCache);
      if (Array.isArray(roles) && roles.length) {
        localStorage.setItem('userRoles', JSON.stringify(roles));
      }

      // Mostrar tarjeta + chip admin
      if (esAdmin(roles)) {
        if (adminCardWrap) adminCardWrap.classList.remove('d-none');
        if (adminChip)     adminChip.classList.remove('d-none');
      }
    })
    .catch((err) => {
      console.warn('[hub] /api/me falló:', err);
    });
}
  /* -------------------------------------------------------------
     5) TARJETAS "PRÓXIMAMENTE" — solo toast, no navegan
        (Dashboard de capas y GeoLibre)
     ------------------------------------------------------------- */
  let toastTimer = null;

  document.querySelectorAll('.hub-card--soon').forEach((card) => {
    card.addEventListener('click', () => {
      const nombre = card.getAttribute('data-soon') || 'Esta sección';
      mostrarToast(`${nombre} estará disponible próximamente.`);
    });
  });

  function mostrarToast(mensaje) {
    if (!toast) return;
    const textEl = toast.querySelector('.toast-text');
    if (textEl) textEl.textContent = mensaje;
    else toast.textContent = mensaje;

    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  /* -------------------------------------------------------------
     6) REVEAL ESCALONADO
     ------------------------------------------------------------- */
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reveals = document.querySelectorAll('.reveal');

  if (!reduce) {
    reveals.forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(18px)';
      const delay =
        parseFloat(getComputedStyle(el).getPropertyValue('--delay')) || 0;
      setTimeout(() => {
        el.style.transition =
          'opacity .6s cubic-bezier(.2,.7,.2,1), transform .6s cubic-bezier(.2,.7,.2,1)';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, delay * 1000);
    });
  } else {
    reveals.forEach((el) => {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
  }

  /* -------------------------------------------------------------
     7) CONTADORES ANIMADOS
     ------------------------------------------------------------- */
  document.querySelectorAll('[data-counter]').forEach((el) => {
    const target = parseInt(el.getAttribute('data-counter'), 10) || 0;

    if (reduce) {
      el.textContent = String(target);
      return;
    }

    const start = performance.now();
    const dur = 1400;

    const tick = (now) => {
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  /* -------------------------------------------------------------
     8) HALO RADIAL QUE SIGUE AL CURSOR
     ------------------------------------------------------------- */
  document.querySelectorAll('.hub-card--active').forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      card.style.setProperty('--mx', x + '%');
      card.style.setProperty('--my', y + '%');
    });
  });
});