/**
 * Configuración compartida del frontend GeoSteam.
 * Se puede sobreescribir definiendo estas variables ANTES de cargar este
 * script, por ejemplo en producción:
 *
 *   <script>
 *     window.GEOSTEAM_API_BASE = "https://api.tudominio.com";
 *     window.GEOSTEAM_GEOSERVER_ADMIN_URL = "https://geo.tudominio.com/geoserver/web/";
 *   </script>
 *   <script src="js/geosteam-config.js"></script>
 */
window.GEOSTEAM_API_BASE = window.GEOSTEAM_API_BASE || '';  

// URL pública de la consola web de GeoServer (para el botón "Abrir GeoServer").
// Es distinta del proxy interno /geoserver/ que usa el mapa para pedir datos.
window.GEOSTEAM_GEOSERVER_ADMIN_URL =
  window.GEOSTEAM_GEOSERVER_ADMIN_URL || '';
