window.GEOSTEAM_GEOSERVER = {
  GEOSERVER_URL: '/geoserver', // El proxy del backend
  WORKSPACE: 'geosteam',
  VENEZUELA_EXTENT: [-73.5, 0.6, -59.0, 12.3],
  VENEZUELA_CENTER: [-66.16, 7.5],
};

window.GEOSTEAM_LOAD_LAYERS = function(callback) {
  var token = localStorage.getItem('geosteam_token');
  var API_BASE = window.GEOSTEAM_API_BASE || ''; // El frontend y backend en el mismo dominio

  // ¡Ahora pedimos a NUESTRO BACKEND, no a GeoServer directo!
  fetch(API_BASE + '/api/mis-capas', {
    headers: {
      'Authorization': 'Bearer ' + token 
    }
  })
  .then(res => {
    if (!res.ok) throw new Error('Sin permisos');
    return res.json();
  })
  .then(data => {
    var layers = data.layers.layer;
    
    // Mapa de geometrías (o puedes dejar que el backend te lo mande en el futuro)
    var geomTypes = {
      'Estaciones': 'Point', 'Plantas': 'Point', 
      'Tuberias_oleoductos_gasoductos_FPO': 'LineString',
      'Bloques_Campos_petroleros': 'Polygon', 'Distrito_Anaco': 'Polygon', 
      // ... el resto
    };

    var layerConfigs = layers.map(function(layer) {
      // Limpiamos el nombre para quitar el workspace
      var typeName = layer.name.split(':').pop(); 

      return {
        id: typeName,
        group: 'Petróleo', // O el nombre del workspace que te devuelva el backend si quieres
        label: typeName.replace(/_/g, ' '),
        typeName: typeName,
        geometryType: geomTypes[typeName] || 'Polygon',
        color: '#FF5733',
        defaultVisible: false,
        opacity: 0.7,
        attributeLabels: {},
        demoData: { type: 'FeatureCollection', features: [] }
      };
    });
    callback(layerConfigs);
  })
  .catch(function(err) {
    console.error('Error al cargar capas para el usuario:', err);
    callback([]); // Si no está logueado o no tiene permisos, no se ve nada
  });
};