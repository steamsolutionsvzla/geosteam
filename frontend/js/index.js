// Lector de coordenadas que sigue el cursor
  var readout = document.getElementById('coord-readout');
  var bounds = { latMin: -18, latMax: 4, lonMin: -82, lonMax: -68 };

  function fmt(n, dir){
    var abs = Math.abs(n).toFixed(4);
    return abs + '\u00B0 ' + dir;
  }

  window.addEventListener('mousemove', function(e){
    if (window.innerWidth < 768) return;
    readout.style.opacity = '1';
    readout.style.left = e.clientX + 'px';
    readout.style.top = e.clientY + 'px';

    var xRatio = e.clientX / window.innerWidth;
    var yRatio = e.clientY / window.innerHeight;
    var lon = bounds.lonMin + xRatio * (bounds.lonMax - bounds.lonMin);
    var lat = bounds.latMax - yRatio * (bounds.latMax - bounds.latMin);
    readout.innerHTML = 'LAT ' + fmt(lat, lat >= 0 ? 'N' : 'S') + ' &nbsp; LON ' + fmt(lon, lon >= 0 ? 'E' : 'W');
  });

  window.addEventListener('mouseleave', function(){ readout.style.opacity = '0'; });