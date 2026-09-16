/**
 * GEOSTEAM — Visor cartográfico (MapLibre GL + GeoServer)
 * -----------------------------------------------------------------------
 * - Cada capa del catálogo (geoportal-config.js) se pide por WFS a
 *   GeoServer como GeoJSON (CRS84 / lon,lat). Si el servidor no responde,
 *   la capa muestra datos de demostración con la misma estructura, para
 *   poder trabajar en el visor sin depender de que GeoServer ya esté
 *   arriba.
 * - El panel lateral permite activar/desactivar cada capa y ajustar su
 *   opacidad, agrupadas igual que en la landing (Catastro, Infraestructura,
 *   Ambiente, Movilidad, Riesgo).
 * - Un click sobre el mapa consulta las features en ese punto (sin
 *   importar si son puntos, líneas o polígonos) y muestra sus atributos
 *   en el panel derecho.
 * -----------------------------------------------------------------------
 */

(function () {
  'use strict';

  var CFG = window.GEOSTEAM_GEOSERVER;
  var LAYERS = [];

  // Al inicio, llama a la función de carga
  if (window.GEOSTEAM_LOAD_LAYERS) {
    window.GEOSTEAM_LOAD_LAYERS(function(loadedLayers) {
      LAYERS = loadedLayers;
      // Ahora inicializa todo lo que dependa de LAYERS
      initializeMap(); // Mueve el código de inicialización a esta función
    });
  } else {
    // Si no hay función, usa la variable estática (para compatibilidad)
    LAYERS = window.GEOSTEAM_LAYERS || [];
    initializeMap();
  }

  /* ================================================================= */
  /* DEFINICIÓN DE LA FUNCIÓN initializeMap                            */
  /* ================================================================= */
  function initializeMap() {

    /* ----------------------------------------------------------------- */
    /* 1. Sesión (JWT emitido por el backend FastAPI)                     */
    /* ----------------------------------------------------------------- */

    var API_BASE = window.GEOSTEAM_API_BASE || ''; 
    var token = localStorage.getItem('geosteam_token');
    var sessionBadge = document.getElementById('sessionBadge');

    function setGuestBadge() {
      sessionBadge.innerHTML = 'Invitado · <a href="login.html?next=geoportal.html">iniciar sesión</a>';
      sessionBadge.classList.add('is-guest');
    }

    if (!token) {
      setGuestBadge();
    } else {
      fetch(API_BASE + '/api/me', { headers: { Authorization: 'Bearer ' + token } })
        .then(function (res) { if (!res.ok) throw new Error(); return res.json(); })
        .then(function (user) {
          var name = user.email || user.username || 'Sesión activa';
          sessionBadge.innerHTML = '● ' + name + ' <a href="#" id="logoutLink">salir</a>';
          document.getElementById('logoutLink').addEventListener('click', function (e) {
            e.preventDefault();
            localStorage.removeItem('geosteam_token');
            window.location.reload();
          });
        })
        .catch(function () {
          localStorage.removeItem('geosteam_token');
          setGuestBadge();
        });
    }

    /* ----------------------------------------------------------------- */
    /* 2. Mapa base (MapLibre GL)                                         */
    /* ----------------------------------------------------------------- */

    var STROKE_DARK = '#0E1B2B';
    var venezuelaBounds = [
      [CFG.VENEZUELA_EXTENT[0], CFG.VENEZUELA_EXTENT[1]],
      [CFG.VENEZUELA_EXTENT[2], CFG.VENEZUELA_EXTENT[3]]
    ];

    var map = new maplibregl.Map({
      container: 'map',
      style: { version: 8, glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf', sources: {}, layers: [] },
      center: CFG.VENEZUELA_CENTER,
      zoom: 6,
      minZoom: 4,
      maxZoom: 19,
      attributionControl: false
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    var BASEMAPS = {
      claro: {
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
        ],
        attribution: '&copy; OpenStreetMap'
      },
     oscuro: {
    tiles: [
       'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
    ],
    attribution: 'Tiles &copy; Esri'
},
      satelite: {
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        attribution: 'Tiles &copy; Esri'
      }
    };

    function addBaseLayers() {
      Object.keys(BASEMAPS).forEach(function (id) {
        var cfg = BASEMAPS[id];
        map.addSource('src-base-' + id, {
          type: 'raster',
          tiles: cfg.tiles,
          tileSize: 256,
          attribution: cfg.attribution
        });
        map.addLayer({
          id: 'base-' + id,
          type: 'raster',
          source: 'src-base-' + id,
          layout: { visibility: id === 'oscuro' ? 'visible' : 'none' }
        });
      });
    }

    /* ----------------------------------------------------------------- */
    /* 3. Capas WFS (con respaldo demo)                                   */
    /* ----------------------------------------------------------------- */

    var layerIdToCfg = {};
    var opacityState = {};
    var emptyFC = { type: 'FeatureCollection', features: [] };

    function buildWfsUrl(layerCfg) {
  // Usamos layerCfg.workspace (que viene del backend) en lugar de CFG.WORKSPACE
  // Si por alguna razón no viene, usamos el que esté en la config global
  var workspace = layerCfg.workspace || CFG.WORKSPACE;

  var typeName = workspace + ':' + layerCfg.typeName;
  var params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: typeName,
    outputFormat: 'application/json',
    srsName: 'urn:ogc:def:crs:OGC::CRS84'
  });
  
  return API_BASE + '/geoserver/' + workspace + '/wfs?' + params.toString();
}

    function selectedExpr(whenTrue, whenFalse) {
      return ['case', ['boolean', ['feature-state', 'selected'], false], whenTrue, whenFalse];
    }

    function addVectorLayers() {
      LAYERS.forEach(function (layerCfg) {
        opacityState[layerCfg.id] = layerCfg.opacity != null ? layerCfg.opacity : 1;

        map.addSource('src-' + layerCfg.id, {
          type: 'geojson',
          data: emptyFC,
          generateId: true
        });

        var mainLayerId = 'lyr-' + layerCfg.id;

        if (layerCfg.geometryType === 'Point') {
          map.addLayer({
            id: mainLayerId,
            type: 'circle',
            source: 'src-' + layerCfg.id,
            layout: { visibility: layerCfg.defaultVisible ? 'visible' : 'none' },
            paint: {
              'circle-radius': selectedExpr(8, 6),
              'circle-color': layerCfg.color,
              'circle-stroke-color': selectedExpr('#FFFFFF', STROKE_DARK),
              'circle-stroke-width': selectedExpr(2.5, 1.5),
              'circle-opacity': opacityState[layerCfg.id]
            }
          });
        } else if (layerCfg.geometryType === 'LineString') {
          map.addLayer({
            id: mainLayerId,
            type: 'line',
            source: 'src-' + layerCfg.id,
            layout: { visibility: layerCfg.defaultVisible ? 'visible' : 'none', 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': selectedExpr('#FFFFFF', layerCfg.color),
              'line-width': selectedExpr(5, 3),
              'line-opacity': opacityState[layerCfg.id]
            }
          });
        } else {
          // Polygon: relleno + contorno
          map.addLayer({
            id: mainLayerId,
            type: 'fill',
            source: 'src-' + layerCfg.id,
            layout: { visibility: layerCfg.defaultVisible ? 'visible' : 'none' },
            paint: {
              'fill-color': layerCfg.color,
              'fill-opacity': selectedExpr(Math.min(0.9, opacityState[layerCfg.id] + 0.35), opacityState[layerCfg.id] * 0.55)
            }
          });
          map.addLayer({
            id: mainLayerId + '-outline',
            type: 'line',
            source: 'src-' + layerCfg.id,
            layout: { visibility: layerCfg.defaultVisible ? 'visible' : 'none' },
            paint: {
              'line-color': selectedExpr('#FFFFFF', layerCfg.color),
              'line-width': selectedExpr(3, 1.5),
              'line-opacity': opacityState[layerCfg.id]
            }
          });
        }

        layerIdToCfg[mainLayerId] = layerCfg;

        // Timeout defensivo: si GeoServer no responde en 6s, usamos demo.
        var controller = new AbortController();
        var timeout = setTimeout(function () { controller.abort(); }, 6000);

        fetch(buildWfsUrl(layerCfg), {
            signal: controller.signal,
            // El proxy exige JWT (Depends(get_current_user)).
            // Si no hay token (usuario invitado), esta petición dará 401
            // y el .catch() de abajo cae automáticamente a demoData.
            headers: token ? { Authorization: 'Bearer ' + token } : {}
          })
          .then(function (res) {
            clearTimeout(timeout);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
          })
          .then(function (geojson) {
            map.getSource('src-' + layerCfg.id).setData(geojson);
            setLayerSourceBadge(layerCfg.id, 'geoserver', (geojson.features || []).length);
          })
          .catch(function () {
            clearTimeout(timeout);
            map.getSource('src-' + layerCfg.id).setData(layerCfg.demoData);
            setLayerSourceBadge(layerCfg.id, 'demo', layerCfg.demoData.features.length);
          });
      });
    }

    function applyOpacity(layerCfg) {
      var val = opacityState[layerCfg.id];
      var mainLayerId = 'lyr-' + layerCfg.id;

      if (layerCfg.geometryType === 'Point') {
        map.setPaintProperty(mainLayerId, 'circle-opacity', val);
      } else if (layerCfg.geometryType === 'LineString') {
        map.setPaintProperty(mainLayerId, 'line-opacity', val);
      } else {
        map.setPaintProperty(mainLayerId, 'fill-opacity', selectedExpr(Math.min(0.9, val + 0.35), val * 0.55));
        map.setPaintProperty(mainLayerId + '-outline', 'line-opacity', val);
      }
    }

    /* ----------------------------------------------------------------- */
    /* 4. Vista inicial / controles de zoom                               */
    /* ----------------------------------------------------------------- */

    map.on('load', function () {
      addBaseLayers();
      addVectorLayers();
      map.fitBounds(venezuelaBounds, { padding: 40, duration: 0 });
      attachClickHandling();
    });

    document.getElementById('btnZoomIn').addEventListener('click', function () {
      map.zoomIn({ duration: 200 });
    });
    document.getElementById('btnZoomOut').addEventListener('click', function () {
      map.zoomOut({ duration: 200 });
    });
    document.getElementById('btnFitVenezuela').addEventListener('click', function () {
      map.fitBounds(venezuelaBounds, { padding: 40, duration: 400 });
    });

    /* ----------------------------------------------------------------- */
    /* 5. Selector de mapa base                                           */
    /* ----------------------------------------------------------------- */

    document.querySelectorAll('.basemap-option').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-base');
        Object.keys(BASEMAPS).forEach(function (baseId) {
          if (map.getLayer('base-' + baseId)) {
            map.setLayoutProperty('base-' + baseId, 'visibility', baseId === id ? 'visible' : 'none');
          }
        });
        document.querySelectorAll('.basemap-option').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });

    /* ----------------------------------------------------------------- */
    /* 6. Coordenadas del cursor                                          */
    /* ----------------------------------------------------------------- */

    var coordReadout = document.getElementById('coord-readout');
    map.on('mousemove', function (evt) {
      coordReadout.textContent =
        'LAT ' + evt.lngLat.lat.toFixed(4) + '°  LON ' + evt.lngLat.lng.toFixed(4) + '°';
    });

    /* ----------------------------------------------------------------- */
    /* 7. Panel de capas (activar/desactivar + opacidad)                  */
    /* ----------------------------------------------------------------- */

       /* ----------------------------------------------------------------- */
    /* 7. Panel de capas (activar/desactivar + opacidad)                  */
    /* ----------------------------------------------------------------- */

    // Generar el orden de los grupos dinámicamente según las capas recibidas
    var groupOrder = [];
    LAYERS.forEach(function (l) {
      if (groupOrder.indexOf(l.group) === -1) {
        groupOrder.push(l.group);
      }
    });

    var groups = {};
    LAYERS.forEach(function (l) {
      if (!groups[l.group]) groups[l.group] = [];
      groups[l.group].push(l);
    });

    var layerListEl = document.getElementById('layerList');
    var geomIcon = {
      Point: '●',
      LineString: '—',
      Polygon: '▮'
    };

    groupOrder.forEach(function (groupName) {
      // El resto del código de creación de los detalles y las filas sigue igual
      // ... (copia desde aquí hacia abajo hasta el final del forEach anterior)
      if (!groups[groupName]) return;

      var groupWrap = document.createElement('details');
      groupWrap.className = 'layer-group';
      groupWrap.open = true;

      var summary = document.createElement('summary');
      summary.textContent = groupName;
      groupWrap.appendChild(summary);

      groups[groupName].forEach(function (layerCfg) {
        var row = document.createElement('div');
        row.className = 'layer-row';
        row.id = 'layer-row-' + layerCfg.id;

        var top = document.createElement('label');
        top.className = 'layer-row-top';

        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !!layerCfg.defaultVisible;

        var swatch = document.createElement('span');
        swatch.className = 'layer-swatch';
        swatch.style.color = layerCfg.color;
        swatch.textContent = geomIcon[layerCfg.geometryType] || '●';

        var name = document.createElement('span');
        name.className = 'layer-name';
        name.textContent = layerCfg.label;

        var badge = document.createElement('span');
        badge.className = 'layer-badge';
        badge.id = 'badge-' + layerCfg.id;
        badge.textContent = '···';

        top.appendChild(checkbox);
        top.appendChild(swatch);
        top.appendChild(name);
        top.appendChild(badge);

        var opacityRow = document.createElement('div');
        opacityRow.className = 'layer-opacity';
        var opacitySlider = document.createElement('input');
        opacitySlider.type = 'range';
        opacitySlider.min = '0.1';
        opacitySlider.max = '1';
        opacitySlider.step = '0.1';
        opacitySlider.value = layerCfg.opacity != null ? layerCfg.opacity : 1;
        opacityRow.appendChild(opacitySlider);

        row.appendChild(top);
        row.appendChild(opacityRow);
        groupWrap.appendChild(row);

        function setVisibility(visible) {
          var vis = visible ? 'visible' : 'none';
          map.setLayoutProperty('lyr-' + layerCfg.id, 'visibility', vis);
          if (layerCfg.geometryType === 'Polygon') {
            map.setLayoutProperty('lyr-' + layerCfg.id + '-outline', 'visibility', vis);
          }
        }

        checkbox.addEventListener('change', function () {
          if (map.isStyleLoaded() && map.getLayer('lyr-' + layerCfg.id)) {
            setVisibility(checkbox.checked);
          } else {
            map.once('load', function () { setVisibility(checkbox.checked); });
          }
          row.classList.toggle('is-off', !checkbox.checked);
        });
        opacitySlider.addEventListener('input', function () {
          opacityState[layerCfg.id] = parseFloat(opacitySlider.value);
          if (map.getLayer('lyr-' + layerCfg.id)) applyOpacity(layerCfg);
        });

        if (!layerCfg.defaultVisible) row.classList.add('is-off');
      });

      layerListEl.appendChild(groupWrap);
    });

    function setLayerSourceBadge(layerId, source, count) {
      var badge = document.getElementById('badge-' + layerId);
      if (!badge) return;
      if (source === 'geoserver') {
        badge.textContent = count + ' · GeoServer';
        badge.classList.add('is-live');
      } else {
        badge.textContent = count + ' · demo';
        badge.classList.add('is-demo');
      }
    }

    /* ----------------------------------------------------------------- */
    /* 8. Panel lateral: mostrar / ocultar (móvil)                        */
    /* ----------------------------------------------------------------- */

    var sidebar = document.getElementById('layerSidebar');
    document.getElementById('btnToggleLayers').addEventListener('click', function () {
      sidebar.classList.toggle('is-open');
    });

    /* ----------------------------------------------------------------- */
    /* 9. Click en el mapa → panel de atributos                           */
    /* ----------------------------------------------------------------- */

    var infoPanel = document.getElementById('featurePanel');
    var infoBody = document.getElementById('featurePanelBody');
    var infoTitle = document.getElementById('featurePanelTitle');
    var lastSelected = [];

    function clearSelection() {
      lastSelected.forEach(function (ref) {
        map.setFeatureState({ source: ref.source, id: ref.id }, { selected: false });
      });
      lastSelected = [];
    }

    function closeFeaturePanel() {
      infoPanel.classList.remove('is-open');
      clearSelection();
    }

    document.getElementById('btnCloseFeaturePanel').addEventListener('click', closeFeaturePanel);

    function formatValue(v) {
      if (v === null || v === undefined || v === '') return '—';
      return String(v);
    }

    function renderFeatureCard(feature, layerCfg) {
      var card = document.createElement('div');
      card.className = 'feature-card-info';

      var head = document.createElement('div');
      head.className = 'feature-card-head';
      head.innerHTML =
        '<span class="feature-geom-icon" style="color:' + layerCfg.color + '">' +
        (geomIcon[layerCfg.geometryType] || '●') + '</span>' +
        '<span>' + layerCfg.label + '</span>';
      card.appendChild(head);

      var table = document.createElement('table');
      table.className = 'feature-attr-table';
      var props = feature.properties || {};
      var labels = layerCfg.attributeLabels || {};

      Object.keys(props).forEach(function (key) {
        var tr = document.createElement('tr');
        var th = document.createElement('th');
        th.textContent = labels[key] || key;
        var td = document.createElement('td');
        td.textContent = formatValue(props[key]);
        tr.appendChild(th);
        tr.appendChild(td);
        table.appendChild(tr);
      });

      card.appendChild(table);
      return card;
    }

    function attachClickHandling() {
      var queryableLayers = LAYERS.map(function (l) { return 'lyr-' + l.id; });

      map.on('click', function (evt) {
        var bbox = [
          [evt.point.x - 4, evt.point.y - 4],
          [evt.point.x + 4, evt.point.y + 4]
        ];
        var existing = queryableLayers.filter(function (id) { return map.getLayer(id); });
        var raw = map.queryRenderedFeatures(bbox, { layers: existing });

        clearSelection();

        if (!raw.length) {
          closeFeaturePanel();
          return;
        }

        // Deduplicar por (source, id) — un mismo elemento no debe repetirse.
        var seen = {};
        var hits = [];
        raw.forEach(function (f) {
          var key = f.source + ':' + f.id;
          if (seen[key]) return;
          seen[key] = true;
          var cfg = layerIdToCfg[f.layer.id];
          if (!cfg) return;
          hits.push({ feature: f, cfg: cfg });
        });

        if (!hits.length) {
          closeFeaturePanel();
          return;
        }

        infoBody.innerHTML = '';
        infoTitle.textContent = hits.length === 1 ? 'Elemento seleccionado' : hits.length + ' elementos en este punto';

        hits.forEach(function (hit) {
          infoBody.appendChild(renderFeatureCard(hit.feature, hit.cfg));
          map.setFeatureState({ source: hit.feature.source, id: hit.feature.id }, { selected: true });
          lastSelected.push({ source: hit.feature.source, id: hit.feature.id });
        });

        infoPanel.classList.add('is-open');
      });

      map.on('mousemove', function (evt) {
        var existing = queryableLayers.filter(function (id) { return map.getLayer(id); });
        var hits = map.queryRenderedFeatures(evt.point, { layers: existing });
        map.getCanvas().style.cursor = hits.length ? 'pointer' : '';
      });
    }

  } // <-- Cierre de la función initializeMap

})();