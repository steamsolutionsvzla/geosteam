/* ============================================================
   Reveal on scroll
   ============================================================ */
(function () {
  var elementos = document.querySelectorAll('.reveal');
  if (!elementos.length) return;

  // Si el navegador no soporta IntersectionObserver, mostramos todo.
  if (!('IntersectionObserver' in window)) {
    elementos.forEach(function (el) { el.classList.add('is-visible'); });
    return;
  }

  var observer = new IntersectionObserver(
    function (entradas) {
      entradas.forEach(function (entrada) {
        if (entrada.isIntersecting) {
          entrada.target.classList.add('is-visible');
          observer.unobserve(entrada.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
  );

  elementos.forEach(function (el) { observer.observe(el); });
})();