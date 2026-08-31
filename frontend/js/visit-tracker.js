/**
 * Registra una "visita" silenciosa en el backend para poder graficar
 * estadísticas de tráfico en el panel de administrador.
 * No bloquea el render de la página ni muestra errores si el backend
 * no está disponible.
 */
(function () {
  try {
    var API_BASE = window.GEOSTEAM_API_BASE || 'http://localhost:8001';
    var payload = JSON.stringify({
      path: window.location.pathname.split('/').pop() || 'index.html',
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
