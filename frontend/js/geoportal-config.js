// =======================================================
// 1. CONFIGURACIÓN DEL MAPA BASE 
// =======================================================
window.GEOSTEAM_GEOSERVER = {
  GEOSERVER_URL: '/geoserver', // El proxy del backend
  WORKSPACE: 'geosteam',
  VENEZUELA_EXTENT: [-73.5, 0.6, -59.0, 12.3],
  VENEZUELA_CENTER: [-66.16, 7.5],
};

// =======================================================
// 2. CARGA DINÁMICA DE CAPAS (lo que ya tenías)
// =======================================================
window.GEOSTEAM_LOAD_LAYERS = function(callback) {
  var token = localStorage.getItem('geosteam_token');
  var API_BASE = window.GEOSTEAM_API_BASE || ''; // Mismo dominio

  // Si no hay token (usuario invitado), no mandamos Authorization: el
  // backend responde igualmente con las capas públicas (workspace Salud).
  var headers = token ? { 'Authorization': 'Bearer ' + token } : {};

  fetch(API_BASE + '/api/mis-capas', { headers: headers })
  .then(res => {
    if (!res.ok) throw new Error('Sin permisos');
    return res.json();
  })
  .then(data => {
    // El backend devuelve { workspace, available_workspaces, layers }
    if (data && Array.isArray(data.layers)) {
        window.GEOSTEAM_GEOSERVER.WORKSPACE = data.workspace; // El primero (por defecto)
        window.GEOSTEAM_AVAILABLE_WORKSPACES = data.available_workspaces || [];
        callback(data.layers); // Le pasamos TODAS las capas de todos los workspaces
    } else {
        callback([]);
    }
})
  .catch(function(err) {
    console.error('Error al cargar capas para el usuario:', err);
    callback([]); // Sin permisos, no se cargan capas
  });
};