/**
 * GEOSTEAM — Visor cartográfico (MapLibre GL + GeoServer)
 * -----------------------------------------------------------------------
 * - Cada capa del catálogo (geoportal-config.js) se pide por WFS a
 *   GeoServer como GeoJSON (CRS84 / lon,lat). Si el servidor no responde,
 *   la capa muestra datos de demostración con la misma estructura.
 * - El panel lateral permite activar/desactivar cada capa. El slider de
 *   opacidad solo se muestra en capas de tipo Polygon.
 * - Click sobre el mapa → POPUP flotante (compacto, cerrable) con los
 *   atributos de la feature. Los campos tipo ID se omiten.
 * - El panel derecho se reserva para METADATOS de la capa. Se abre con el
 *   botón ⓘ que acompaña a cada capa en el sidebar.
 * - Las capas de puntos pueden usar íconos SVG (registrados en canvas).
 *   La capa "Ambulatorios" usa automáticamente el ícono de hospital.
 * - La brújula (arriba a la derecha) rota con el mapa y devuelve la vista
 *   al estado inicial (Venezuela) al hacer click.
 *
 * NOTA: la sesión (user pill #sessionBadge) vive en geoportal-session.js.
 * Este archivo solo lee el token para autorizar peticiones WFS.
 * -----------------------------------------------------------------------
 */

(function () {
  'use strict';

  var CFG = window.GEOSTEAM_GEOSERVER;
  var LAYERS = [];

  if (window.GEOSTEAM_LOAD_LAYERS) {
    window.GEOSTEAM_LOAD_LAYERS(function (loadedLayers) {
      LAYERS = loadedLayers;
      initializeMap();
    });
  } else {
    LAYERS = window.GEOSTEAM_LAYERS || [];
    initializeMap();
  }

  function initializeMap() {

    /* ----------------------------------------------------------------- */
    /* 0. Loader overlay                                                  */
    /* ----------------------------------------------------------------- */

    var loaderEl = document.getElementById('geoLoader');
    var loaderHidden = false;

    function hideLoader() {
      if (loaderHidden || !loaderEl) return;
      loaderHidden = true;
      loaderEl.classList.add('is-hidden');
      setTimeout(function () {
        if (loaderEl && loaderEl.parentNode) {
          loaderEl.parentNode.removeChild(loaderEl);
        }
      }, 700);
    }

    var loaderSafety = setTimeout(hideLoader, 10000);
    var _hideLoader = hideLoader;
    hideLoader = function () {
      clearTimeout(loaderSafety);
      _hideLoader();
    };

    /* ----------------------------------------------------------------- */
    /* 1. Token                                                           */
    /* ----------------------------------------------------------------- */

    var API_BASE = window.GEOSTEAM_API_BASE || '';
    var token = localStorage.getItem('geosteam_token');

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
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {},
        layers: []
      },
      center: CFG.VENEZUELA_CENTER,
      zoom: 6,
      minZoom: 4,
      maxZoom: 19,
      attributionControl: false
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    /* ----------------------------------------------------------------- */
    /* API keys de tiles                                                  */
    /* ----------------------------------------------------------------- */
    var TILE_KEYS = {
      carto: 'cb1_33kc_1_d2fff4a23840225df4cca1fa'
    };

    var BASEMAPS = {
      claro: {
        tiles: [
          'https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png' +
            (TILE_KEYS.carto ? '?key=' + TILE_KEYS.carto : '')
        ],
        attribution: '&copy; OpenStreetMap &copy; CARTO'
      },
      oscuro: {
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
        ],
        attribution: 'Tiles &copy; Esri'
      },
      satelite: {
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        ],
        attribution: 'Tiles &copy; Esri'
      },
      osm: {
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
        ],
        attribution: '&copy; OpenStreetMap contributors'
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
          layout: { visibility: id === 'claro' ? 'visible' : 'none' }
        });
      });
    }

    /* ----------------------------------------------------------------- */
    /* Íconos para capas de puntos (dibujados en canvas)                  */
    /* ----------------------------------------------------------------- */
    /*
     * Cada ícono es una función que recibe el color de la capa y devuelve
     * un ImageData listo para map.addImage(). Se renderiza a 64px y se
     * escala con icon-size ~0.5 para que se vea nítido en pantallas HiDPI.
     */

    function drawHospitalIcon(fillColor) {
      var S = 64;
      var canvas = document.createElement('canvas');
      canvas.width = S;
      canvas.height = S;
      var ctx = canvas.getContext('2d');

      var cx = S / 2;
      var cy = S / 2;
      var r = S / 2 - 4;

      // Sombra suave bajo el badge
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;

      // Círculo principal
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.restore();

      // Borde blanco
      ctx.beginPath();
      ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();

      // Cruz médica blanca
      var armLen = S * 0.26;
      var armWidth = S * 0.16;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(cx - armWidth / 2, cy - armLen, armWidth, armLen * 2);
      ctx.fillRect(cx - armLen, cy - armWidth / 2, armLen * 2, armWidth);

      return ctx.getImageData(0, 0, S, S);
    }

    var ICON_REGISTRY = {
      hospital: drawHospitalIcon
    };

    // ¿Esta capa debe llevar ícono? Prioridad:
    //   1. layerCfg.icon explícito en el config
    //   2. fallback por id/label que contengan "ambulator"
    function resolveIcon(layerCfg) {
      if (layerCfg.icon && ICON_REGISTRY[layerCfg.icon]) return layerCfg.icon;

      var id = (layerCfg.id || '').toLowerCase();
      var label = (layerCfg.label || '').toLowerCase();
      if (id.indexOf('ambulator') !== -1 || label.indexOf('ambulator') !== -1) {
        return 'hospital';
      }
      return null;
    }

    function registerIconForLayer(layerCfg, iconName) {
      var imageId = 'icon-' + layerCfg.id;
      if (map.hasImage(imageId)) return imageId;
      var imageData = ICON_REGISTRY[iconName](layerCfg.color);
      map.addImage(imageId, imageData, { pixelRatio: 2 });
      return imageId;
    }

    /* ----------------------------------------------------------------- */
    /* 3. Capas WFS                                                       */
    /* ----------------------------------------------------------------- */

    var layerIdToCfg = {};
    var opacityState = {};
    var emptyFC = { type: 'FeatureCollection', features: [] };
    var geomIcon = {
      Point: '●',
      LineString: '—',
      Polygon: '▮'
    };

    function buildWfsUrl(layerCfg) {
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
      var pending = LAYERS.length;
      if (pending === 0) return;

      function layerSettled() {
        pending--;
        if (pending <= 0) hideLoader();
      }

      LAYERS.forEach(function (layerCfg) {
        opacityState[layerCfg.id] = layerCfg.opacity != null ? layerCfg.opacity : 1;

        map.addSource('src-' + layerCfg.id, {
          type: 'geojson',
          data: emptyFC,
          generateId: true
        });

        var mainLayerId = 'lyr-' + layerCfg.id;
        var iconName = resolveIcon(layerCfg);

       
        if (layerCfg.geometryType === 'Point' && iconName) {
          /* -------- Punto con ícono (symbol) -------- */
          var imageId = registerIconForLayer(layerCfg, iconName);

          map.addLayer({
            id: mainLayerId,
            type: 'symbol',
            source: 'src-' + layerCfg.id,
            layout: {
              visibility: layerCfg.defaultVisible ? 'visible' : 'none',
              'icon-image': imageId,
              // fijo: layout no acepta feature-state en MapLibre
              'icon-size': 0.55,
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-anchor': 'center'
            },
            paint: {
              'icon-opacity': opacityState[layerCfg.id],
              // Feedback de selección vía halo (paint SÍ acepta feature-state)
              'icon-halo-color': '#FFFFFF',
              'icon-halo-width': selectedExpr(3, 0),
              'icon-halo-blur': selectedExpr(1, 0)
            }
          });
        } else if (layerCfg.geometryType === 'Point') {
          /* -------- Punto sin ícono (círculo) -------- */
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
            layout: {
              visibility: layerCfg.defaultVisible ? 'visible' : 'none',
              'line-cap': 'round',
              'line-join': 'round'
            },
            paint: {
              'line-color': selectedExpr('#FFFFFF', layerCfg.color),
              'line-width': selectedExpr(5, 3),
              'line-opacity': opacityState[layerCfg.id]
            }
          });

        } else {
          map.addLayer({
            id: mainLayerId,
            type: 'fill',
            source: 'src-' + layerCfg.id,
            layout: { visibility: layerCfg.defaultVisible ? 'visible' : 'none' },
            paint: {
              'fill-color': layerCfg.color,
              'fill-opacity': selectedExpr(
                Math.min(0.9, opacityState[layerCfg.id] + 0.35),
                opacityState[layerCfg.id] * 0.55
              )
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

        var controller = new AbortController();
        var timeout = setTimeout(function () { controller.abort(); }, 6000);

        fetch(buildWfsUrl(layerCfg), {
          signal: controller.signal,
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
            layerSettled();
          })
          .catch(function () {
            clearTimeout(timeout);
            try {
              map.getSource('src-' + layerCfg.id).setData(layerCfg.demoData);
              setLayerSourceBadge(layerCfg.id, 'demo', layerCfg.demoData.features.length);
            } catch (e) { /* noop */ }
            layerSettled();
          });
      });
    }

    function applyOpacity(layerCfg) {
      var val = opacityState[layerCfg.id];
      var mainLayerId = 'lyr-' + layerCfg.id;
      var layer = map.getLayer(mainLayerId);
      if (!layer) return;

      if (layer.type === 'symbol') {
        map.setPaintProperty(mainLayerId, 'icon-opacity', val);
      } else if (layer.type === 'circle') {
        map.setPaintProperty(mainLayerId, 'circle-opacity', val);
      } else if (layer.type === 'line') {
        map.setPaintProperty(mainLayerId, 'line-opacity', val);
      } else if (layer.type === 'fill') {
        map.setPaintProperty(
          mainLayerId,
          'fill-opacity',
          selectedExpr(Math.min(0.9, val + 0.35), val * 0.55)
        );
        if (map.getLayer(mainLayerId + '-outline')) {
          map.setPaintProperty(mainLayerId + '-outline', 'line-opacity', val);
        }
      }
    }

    /* ----------------------------------------------------------------- */
    /* 4. Vista inicial / controles de zoom                               */
    /* ----------------------------------------------------------------- */

    map.on('load', function () {
      addBaseLayers();
      addVectorLayers();
      map.fitBounds(venezuelaBounds, { padding: 40, duration: 0 });
      attachPopupHandling();

      if (LAYERS.length === 0) hideLoader();
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
            map.setLayoutProperty(
              'base-' + baseId,
              'visibility',
              baseId === id ? 'visible' : 'none'
            );
          }
        });
        document.querySelectorAll('.basemap-option').forEach(function (b) {
          b.classList.remove('active');
        });
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
    /* 7. Brújula                                                         */
    /* ----------------------------------------------------------------- */

    var compassBtn = document.getElementById('btnCompass');
    var compassSvg = compassBtn ? compassBtn.querySelector('svg') : null;
    var initialView = null;

    map.once('idle', function () {
      initialView = {
        center: map.getCenter(),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch()
      };
    });

    function updateCompass() {
      if (!compassSvg) return;
      var bearing = map.getBearing();
      compassSvg.style.transform = 'rotate(' + (-bearing) + 'deg)';
    }

    function updateOffViewState() {
      if (!compassBtn || !initialView) return;
      var c = map.getCenter();
      var z = map.getZoom();
      var b = map.getBearing();
      var p = map.getPitch();
      var moved =
        Math.abs(c.lng - initialView.center.lng) > 0.0005 ||
        Math.abs(c.lat - initialView.center.lat) > 0.0005 ||
        Math.abs(z - initialView.zoom) > 0.01 ||
        Math.abs(b - initialView.bearing) > 0.5 ||
        Math.abs(p - initialView.pitch) > 0.5;
      compassBtn.classList.toggle('is-off-view', moved);
    }

    map.on('rotate', updateCompass);
    map.on('move', updateOffViewState);
    map.on('zoom', updateOffViewState);
    map.on('pitch', updateOffViewState);

    if (compassBtn) {
      compassBtn.addEventListener('click', function () {
        if (!initialView) return;
        map.easeTo({
          center: initialView.center,
          zoom: initialView.zoom,
          bearing: initialView.bearing,
          pitch: initialView.pitch,
          duration: 900,
          easing: function (t) {
            return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
          }
        });
      });
    }

    /* ----------------------------------------------------------------- */
    /* 8. Panel de capas (activar/desactivar + opacidad + metadatos)      */
    /* ----------------------------------------------------------------- */

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

    var geomOrder = { Point: 0, LineString: 1, Polygon: 2 };
    Object.keys(groups).forEach(function (g) {
      groups[g].sort(function (a, b) {
        var oa = geomOrder[a.geometryType] != null ? geomOrder[a.geometryType] : 99;
        var ob = geomOrder[b.geometryType] != null ? geomOrder[b.geometryType] : 99;
        return oa - ob;
      });
    });

    var layerListEl = document.getElementById('layerList');

    groupOrder.forEach(function (groupName) {
      if (!groups[groupName]) return;

      var groupWrap = document.createElement('details');
      groupWrap.className = 'layer-group';
      groupWrap.open = false;

      var summary = document.createElement('summary');
      summary.textContent = groupName;
      groupWrap.appendChild(summary);

      groups[groupName].forEach(function (layerCfg) {
        var row = document.createElement('div');
        row.className = 'layer-row';
        row.id = 'layer-row-' + layerCfg.id;

        var top = document.createElement('div');
        top.className = 'layer-row-top';

        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !!layerCfg.defaultVisible;

        var swatch = document.createElement('span');
        swatch.className = 'layer-swatch';
        swatch.style.color = layerCfg.color;
        // Si la capa usa ícono, mostramos el ícono de hospital en el swatch
        // del sidebar para que haga juego con lo que se ve en el mapa.
        var resolved = resolveIcon(layerCfg);
        if (resolved === 'hospital') {
          swatch.innerHTML =
            '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" aria-hidden="true">' +
              '<rect x="6.6" y="2.5" width="2.8" height="11" rx="0.6" fill="#FFFFFF"/>' +
              '<rect x="2.5" y="6.6" width="11" height="2.8" rx="0.6" fill="#FFFFFF"/>' +
            '</svg>';
        } else {
          swatch.textContent = geomIcon[layerCfg.geometryType] || '●';
        }

        var name = document.createElement('span');
        name.className = 'layer-name';
        name.textContent = layerCfg.label;

        var badge = document.createElement('span');
        badge.className = 'layer-badge';
        badge.id = 'badge-' + layerCfg.id;
        badge.textContent = '···';
        badge.title = 'Cargando…';

        var metaBtn = document.createElement('button');
        metaBtn.type = 'button';
        metaBtn.className = 'layer-meta-btn';
        metaBtn.title = 'Ver metadatos';
        metaBtn.setAttribute('aria-label', 'Ver metadatos de ' + layerCfg.label);
        metaBtn.innerHTML =
          '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">' +
            '<circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/>' +
            '<line x1="8" y1="7" x2="8" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
            '<circle cx="8" cy="4.8" r="0.85" fill="currentColor"/>' +
          '</svg>';

        metaBtn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          openMetadataPanel(layerCfg);
        });

        top.addEventListener('click', function (e) {
          if (e.target.closest('.layer-meta-btn')) return;
          if (e.target === checkbox) return;
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        });

        top.appendChild(checkbox);
        top.appendChild(swatch);
        top.appendChild(name);
        top.appendChild(badge);
        top.appendChild(metaBtn);

        row.appendChild(top);

        if (layerCfg.geometryType === 'Polygon') {
          var opacityRow = document.createElement('div');
          opacityRow.className = 'layer-opacity';

          var opacitySlider = document.createElement('input');
          opacitySlider.type = 'range';
          opacitySlider.min = '0.1';
          opacitySlider.max = '1';
          opacitySlider.step = '0.1';
          opacitySlider.value = layerCfg.opacity != null ? layerCfg.opacity : 1;
          opacityRow.appendChild(opacitySlider);

          opacitySlider.addEventListener('input', function () {
            opacityState[layerCfg.id] = parseFloat(opacitySlider.value);
            if (map.getLayer('lyr-' + layerCfg.id)) applyOpacity(layerCfg);
          });

          row.appendChild(opacityRow);
        }

        groupWrap.appendChild(row);

        function setVisibility(visible) {
          var vis = visible ? 'visible' : 'none';
          map.setLayoutProperty('lyr-' + layerCfg.id, 'visibility', vis);
          if (layerCfg.geometryType === 'Polygon' && map.getLayer('lyr-' + layerCfg.id + '-outline')) {
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

        if (!layerCfg.defaultVisible) row.classList.add('is-off');
      });

      layerListEl.appendChild(groupWrap);
    });

    function setLayerSourceBadge(layerId, source, count) {
      var badge = document.getElementById('badge-' + layerId);
      if (!badge) return;
      badge.textContent = count;
      badge.classList.toggle('is-live', source === 'geoserver');
      badge.classList.toggle('is-demo', source === 'demo');
      badge.title = source === 'geoserver'
        ? count + ' elementos desde GeoServer'
        : count + ' elementos de demostración';
    }

    /* ----------------------------------------------------------------- */
    /* 9. Panel lateral: mostrar / ocultar (móvil)                        */
    /* ----------------------------------------------------------------- */

    var sidebar = document.getElementById('layerSidebar');
    document.getElementById('btnToggleLayers').addEventListener('click', function () {
      sidebar.classList.toggle('is-open');
    });

    /* ----------------------------------------------------------------- */
    /* 10. Panel derecho: METADATOS de la capa                            */
    /* ----------------------------------------------------------------- */

    var metaPanel = document.getElementById('featurePanel');
    var metaBody = document.getElementById('featurePanelBody');
    var metaTitle = document.getElementById('featurePanelTitle');

    document.getElementById('btnCloseFeaturePanel').addEventListener('click', function () {
      metaPanel.classList.remove('is-open');
    });

    function isIdField(key) {
      var k = key.toLowerCase();
      if (k === 'id' || k === 'fid' || k === 'gid' ||
          k === 'objectid' || k === 'ogc_fid' ||
          k === 'uuid' || k === 'guid') return true;
      if (k.indexOf('id_') === 0) return true;
      if (k.indexOf('_id') !== -1) return true;
      if (/^id[A-Z]/.test(key)) return true;
      return false;
    }

    function renderEmptyState() {
      var wrap = document.createElement('div');
      wrap.className = 'feature-empty';
      wrap.innerHTML =
        '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
          '<circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.2"/>' +
          '<line x1="12" y1="10.5" x2="12" y2="17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
          '<circle cx="12" cy="7.3" r="1" fill="currentColor"/>' +
        '</svg>' +
        '<p class="empty-title">No hay metadatos</p>' +
        '<p class="empty-hint">Esta capa todavía no tiene metadatos definidos.</p>';
      return wrap;
    }

    function openMetadataPanel(layerCfg) {
      metaTitle.textContent = 'Metadatos · ' + layerCfg.label;
      metaBody.innerHTML = '';

      var meta = layerCfg.metadata;
      var keys = (meta && typeof meta === 'object')
        ? Object.keys(meta).filter(function (k) { return !isIdField(k); })
        : [];

      if (keys.length === 0) {
        metaBody.appendChild(renderEmptyState());
      } else {
        var table = document.createElement('table');
        table.className = 'feature-meta-table';

        keys.forEach(function (key) {
          var tr = document.createElement('tr');
          var th = document.createElement('th');
          th.textContent = key;
          var td = document.createElement('td');
          var v = meta[key];
          td.textContent = (v === null || v === undefined || v === '') ? '—' : String(v);
          tr.appendChild(th);
          tr.appendChild(td);
          table.appendChild(tr);
        });

        metaBody.appendChild(table);
      }

      metaPanel.classList.add('is-open');
    }

    /* ----------------------------------------------------------------- */
    /* 11. Click en el mapa → POPUP de atributos (compacto, cerrable)     */
    /* ----------------------------------------------------------------- */

    var attrPopup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
      offset: 16,
      maxWidth: '260px',
      className: 'geo-attr-popup'
    });

    function formatValue(v) {
      if (v === null || v === undefined || v === '') return '—';
      if (typeof v === 'object') {
        try { return JSON.stringify(v); } catch (e) { return String(v); }
      }
      return String(v);
    }

    function buildPopupContent(hits) {
      var body = document.createElement('div');
      body.className = 'geo-attr-popup-body';

      var header = document.createElement('div');
      header.className = 'geo-attr-popup-header';
      var titleText = hits.length === 1
        ? hits[0].cfg.label
        : hits.length + ' capas en este punto';
      header.innerHTML =
        '<span class="geom-icon" style="color:' +
          (hits.length === 1 ? hits[0].cfg.color : 'var(--teal)') + '">' +
          (hits.length === 1
            ? (geomIcon[hits[0].cfg.geometryType] || '●')
            : '◆') +
        '</span>' +
        '<span class="title"></span>';
      header.querySelector('.title').textContent = titleText;
      body.appendChild(header);

      hits.forEach(function (hit) {
        var section = document.createElement('div');
        section.className = 'geo-attr-popup-section';

        if (hits.length > 1) {
          var st = document.createElement('div');
          st.className = 'section-title';
          var dot = document.createElement('span');
          dot.className = 'dot';
          dot.style.background = hit.cfg.color;
          st.appendChild(dot);
          var stText = document.createElement('span');
          stText.textContent = hit.cfg.label;
          st.appendChild(stText);
          section.appendChild(st);
        }

        var table = document.createElement('table');
        table.className = 'geo-attr-popup-table';

        var props = hit.feature.properties || {};
        var labels = hit.cfg.attributeLabels || {};
        var keys = Object.keys(props).filter(function (k) { return !isIdField(k); });

        if (keys.length === 0) {
          var trEmpty = document.createElement('tr');
          var thEmpty = document.createElement('th');
          thEmpty.textContent = 'Atributos';
          var tdEmpty = document.createElement('td');
          tdEmpty.textContent = '—';
          trEmpty.appendChild(thEmpty);
          trEmpty.appendChild(tdEmpty);
          table.appendChild(trEmpty);
        } else {
          keys.forEach(function (k) {
            var tr = document.createElement('tr');
            var th = document.createElement('th');
            th.textContent = labels[k] || k;
            var td = document.createElement('td');
            td.textContent = formatValue(props[k]);
            tr.appendChild(th);
            tr.appendChild(td);
            table.appendChild(tr);
          });
        }

        section.appendChild(table);
        body.appendChild(section);
      });

      return body;
    }

    function attachPopupHandling() {
      var queryableLayers = LAYERS.map(function (l) { return 'lyr-' + l.id; });

      map.on('click', function (evt) {
        var bbox = [
          [evt.point.x - 4, evt.point.y - 4],
          [evt.point.x + 4, evt.point.y + 4]
        ];
        var existing = queryableLayers.filter(function (id) { return map.getLayer(id); });
        var raw = map.queryRenderedFeatures(bbox, { layers: existing });

        if (!raw.length) {
          attrPopup.remove();
          return;
        }

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
          attrPopup.remove();
          return;
        }

        attrPopup
          .setLngLat(evt.lngLat)
          .setDOMContent(buildPopupContent(hits))
          .addTo(map);
      });

      map.on('mousemove', function (evt) {
        var existing = queryableLayers.filter(function (id) { return map.getLayer(id); });
        var hits = map.queryRenderedFeatures(evt.point, { layers: existing });
        map.getCanvas().style.cursor = hits.length ? 'pointer' : '';
      });
    }

  } // <-- Cierre de initializeMap

})();