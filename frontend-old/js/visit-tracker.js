/**
 * Registra una "visita" silenciosa en el backend para poder graficar
 * estadísticas de tráfico en el panel de administrador.
 * No bloquea el render de la página ni muestra errores si el backend
 * no está disponible.
 */
(function () {
  try {
    var API_BASE = window.GEOSTEAM_API_BASE || '';

    // Normaliza /login → login.html, / → index.html
    var path = window.location.pathname;
    var last = path.split('/').pop();
    if (!last) {
      last = 'index.html';
    } else if (!/\.[a-z0-9]+$/i.test(last)) {
      last = last + '.html';
    }

    var payload = JSON.stringify({
      path: last,
      referrer: document.referrer || ''
    });

    if (navigator.sendBeacon) {
      var blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(API_BASE + '/api/stats/visit', blob);
    } else {
      fetch(API_BASE + '/api/stats/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
      }).catch(function () {});
    }
  } catch (e) {
    // El tracking nunca debe romper la página.
  }
})();