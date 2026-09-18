/**
 * GEOSTEAM — Sesión del Geoportal
 * -----------------------------------------------------------------------
 * Pinta el user pill (#sessionBadge) con los datos de /api/me.
 * Es independiente del mapa: no toca MapLibre ni las capas.
 * Si falla, solo afecta a la pill, no al visor.
 * -----------------------------------------------------------------------
 * CAMBIOS:
 * - El enlace "Iniciar sesión" ya NO lleva ?next=/geoportal.
 * - El logout limpia TODAS las claves de sesión y redirige a / (index).
 * -----------------------------------------------------------------------
 */

(function () {
  'use strict';

  var API_BASE = window.GEOSTEAM_API_BASE || '';
  var HOME_URL = '/';                        // index.astro
  var token = localStorage.getItem('geosteam_token');
  var sessionBadge = document.getElementById('sessionBadge');

  // Si el DOM aún no tiene #sessionBadge, salimos silenciosamente.
  if (!sessionBadge) return;

  /* -------------------------------------------------------------
     Utilidad: limpiar TODA la sesión de localStorage
     ------------------------------------------------------------- */
  function clearSession() {
    var keys = [
      'geosteam_token',
      'auth_session',
      'userEmail',
      'userName',
      'userRole',
      'userRoles',
      'userWorkspaces',
      'userId'
    ];
    keys.forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    });
  }

  /* -------------------------------------------------------------
     Badge de invitado
     ------------------------------------------------------------- */
  function setGuestBadge() {
    sessionBadge.classList.add('is-guest');
    sessionBadge.innerHTML =
      '<span class="user-avatar is-guest" aria-hidden="true">?</span>' +
      '<span class="user-info">' +
        '<span class="user-name">Invitado</span>' +
        // ✅ Sin ?next= — el login decide el destino por ROL
        '<a class="user-action" href="/login">Iniciar sesión</a>' +
      '</span>';
  }

  /* -------------------------------------------------------------
     Badge de usuario logueado
     ------------------------------------------------------------- */
  function setUserBadge(user) {
    var email = user.email || user.username || 'Sesión activa';
    var initial = (email.charAt(0) || '?').toUpperCase();
    var roles = Array.isArray(user.roles) ? user.roles : [];
    var roleLabel = roles.indexOf('ROLE_ADMIN') !== -1 ? 'Administrador' : 'Usuario';

    sessionBadge.classList.remove('is-guest');
    sessionBadge.innerHTML =
      '<span class="user-avatar" aria-hidden="true">' + initial + '</span>' +
      '<span class="user-info">' +
        '<span class="user-name">' + email + '</span>' +
        '<span class="user-role">' + roleLabel + '</span>' +
      '</span>' +
      '<button type="button" class="user-logout" id="logoutLink" ' +
              'title="Cerrar sesión" aria-label="Cerrar sesión">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
             'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>' +
          '<polyline points="16 17 21 12 16 7"/>' +
          '<line x1="21" y1="12" x2="9" y2="12"/>' +
        '</svg>' +
      '</button>';

    var logoutBtn = document.getElementById('logoutLink');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function (e) {
        e.preventDefault();

        // 1. Limpiamos TODA la sesión
        clearSession();

        // 2. Avisamos a otros scripts por si quieren reaccionar
        try {
          window.dispatchEvent(new CustomEvent('geosteam:logout'));
        } catch (err) { /* noop */ }

        // 3. Redirigimos SIEMPRE al index (/)
        try { window.location.replace(HOME_URL); }
        catch (err) { window.location.href = HOME_URL; }
      });
    }
  }

  /* -------------------------------------------------------------
     Sin token → invitado
     ------------------------------------------------------------- */
  if (!token) {
    setGuestBadge();
    return;
  }

  /* -------------------------------------------------------------
     Con token → pedimos /api/me y pintamos el badge
     ------------------------------------------------------------- */
  fetch(API_BASE + '/api/me', { headers: { Authorization: 'Bearer ' + token } })
    .then(function (res) { if (!res.ok) throw new Error(); return res.json(); })
    .then(setUserBadge)
    .catch(function () {
      clearSession();
      setGuestBadge();
    });

})();