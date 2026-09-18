/* ============================================================
   LOGIN — Autenticación de usuarios GeoSteam
   ------------------------------------------------------------
   IMPORTANTE:
   - Tras login exitoso se redirige SIEMPRE por ROL:
       · ROLE_ADMIN → /admin
       · resto      → /hub
   - Se IGNORA cualquier ?next= o ?redirect= que venga en la URL.
   - Se usa window.location.replace() para no dejar el login
     en el historial del navegador.
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ==========================================================
     1) REFERENCIAS AL DOM
     ========================================================== */
  const form          = document.getElementById('loginForm');
  const emailInput    = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const emailError    = document.getElementById('emailError');
  const passwordError = document.getElementById('passwordError');
  const togglePassword= document.getElementById('togglePass');
  const btnLogin      = document.getElementById('btnLogin');
  const btnText       = document.getElementById('btnText');
  const spinner       = document.getElementById('spinner');
  const alertBox      = document.getElementById('alertBox');

  const API_BASE = window.GEOSTEAM_API_BASE || '';


  /* ==========================================================
     1.1) LIMPIEZA DE PARÁMETROS DE URL
     Si alguien llega a /login?next=/geoportal o ?redirect=/geoportal,
     borramos esos parámetros para que no queden "pegados" y evitar
     cualquier confusión posterior. No se usan para nada.
     ========================================================== */
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('next') || url.searchParams.has('redirect')) {
      url.searchParams.delete('next');
      url.searchParams.delete('redirect');
      window.history.replaceState({}, '', url.pathname);
    }
  } catch (e) { /* noop */ }


  /* ==========================================================
     1.2) SI YA HAY TOKEN, REDIRIGIR POR ROL DE UNA VEZ
     Evita que un usuario logueado vuelva a ver el formulario.
     ========================================================== */
  try {
    const existingToken = localStorage.getItem('geosteam_token');
    if (existingToken) {
      const rolGuardado = localStorage.getItem('userRole') || 'usuario';
      const destinoYa   = rolGuardado === 'admin' ? '/admin' : '/hub';
      window.location.replace(destinoYa);
      return;
    }
  } catch (e) { /* noop */ }


  /* ==========================================================
     2) ESTADO DEL BOTÓN
     ========================================================== */
  function setCargando(cargando) {
    if (!btnLogin) return;
    btnLogin.disabled = cargando;
    if (spinner) spinner.classList.toggle('d-none', !cargando);
    if (btnText) btnText.textContent = cargando ? 'Iniciando...' : 'Iniciar sesión';
  }


  /* ==========================================================
     3) MOSTRAR / OCULTAR CONTRASEÑA
     ========================================================== */
  if (togglePassword && passwordInput) {
    togglePassword.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      togglePassword.textContent = isPassword ? '🙈' : '👁';
    });
  }


  /* ==========================================================
     4) VALIDACIONES Y HELPERS DE UI
     ========================================================== */
  function validarEmail(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
  }

  function mostrarError(input, errorEl, mensaje) {
    input.classList.add('is-invalid');
    errorEl.textContent = mensaje;
  }

  function limpiarError(input, errorEl) {
    input.classList.remove('is-invalid');
    errorEl.textContent = '';
  }

  function mostrarAlerta(mensaje, tipo = 'error') {
    if (!alertBox) return;
    if (!mensaje) {
      alertBox.textContent = '';
      alertBox.className = 'alert d-none';
      alertBox.style.display = 'none';
      return;
    }
    alertBox.textContent = mensaje;
    alertBox.className = `alert show ${tipo}`;
    alertBox.style.display = 'block';
  }


  /* ==========================================================
     5) PERSISTENCIA DE SESIÓN EN LOCALSTORAGE
     ========================================================== */
  function guardarSesion({ token, usuario, email }) {
    localStorage.setItem('geosteam_token', token);
    localStorage.setItem('auth_session', 'activo');
    localStorage.setItem('userEmail', email);

    if (!usuario) return;

    // Roles y workspaces (arrays)
    localStorage.setItem('userRoles', JSON.stringify(usuario.roles || []));
    localStorage.setItem('userWorkspaces', JSON.stringify(usuario.workspaces || []));

    // Nombre visible
    if (usuario.nombre) {
      localStorage.setItem('userName', usuario.nombre);
    }

    // Rol legible derivado ("admin", "lector", ...)
    const roles = Array.isArray(usuario.roles) ? usuario.roles : [];
    const esAdmin = roles.includes('ROLE_ADMIN');
    const rolLegible = esAdmin
      ? 'admin'
      : (roles[0] || 'usuario').replace('ROLE_', '').toLowerCase();
    localStorage.setItem('userRole', rolLegible);

    // ID numérico
    if (usuario.id != null) {
      localStorage.setItem('userId', String(usuario.id));
    }
  }


  /* ==========================================================
     6) DESTINO POST-LOGIN  (CORREGIDO)
     ----------------------------------------------------------
     Regla: NUNCA se respeta ?next= ni ?redirect=.
     Siempre:
       · ROLE_ADMIN → /admin
       · resto      → /hub
     ========================================================== */
  function calcularDestino(usuario) {
    const roles   = (usuario && usuario.roles) || [];
    const esAdmin = roles.includes('ROLE_ADMIN');

    // Sin excepciones: admin a /admin, todos los demás a /hub.
    return esAdmin ? '/admin' : '/hub';
  }


  /* ==========================================================
     7) SUBMIT DEL FORMULARIO
     ========================================================== */
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    /* ---- 7.1 Validación de campos ---- */
    let esValido = true;

    if (!emailInput.value.trim()) {
      mostrarError(emailInput, emailError, 'El correo es obligatorio');
      esValido = false;
    } else if (!validarEmail(emailInput.value.trim())) {
      mostrarError(emailInput, emailError, 'Ingresa un correo válido');
      esValido = false;
    } else {
      limpiarError(emailInput, emailError);
    }

    if (!passwordInput.value) {
      mostrarError(passwordInput, passwordError, 'La contraseña es obligatoria');
      esValido = false;
    } else if (passwordInput.value.length < 6) {
      mostrarError(passwordInput, passwordError, 'Debe tener al menos 6 caracteres');
      esValido = false;
    } else {
      limpiarError(passwordInput, passwordError);
    }

    if (!esValido) return;

    /* ---- 7.2 Preparar UI ---- */
    mostrarAlerta('');
    setCargando(true);
    let redirigiendo = false;

    try {
      /* ---- 7.3 Llamada al backend ---- */
      const response = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailInput.value.trim(),
          password: passwordInput.value,
        }),
      });

      const data = await response.json();

      /* ---- 7.4 Login fallido ---- */
      if (!response.ok) {
        mostrarAlerta(data.detail || 'Credenciales incorrectas', 'error');
        return;
      }

      /* ---- 7.5 Login exitoso: normalizar token ---- */
      let token = data.access_token || data.token;
      if (!token) {
        mostrarAlerta('Error interno: No se recibió token de acceso.', 'error');
        return;
      }
      if (typeof token === 'string' && token.startsWith('Bearer ')) {
        token = token.slice(7);
      }
      token = token.trim();

      /* ---- 7.6 Persistir sesión ---- */
      guardarSesion({
        token,
        usuario: data.usuario,
        email: emailInput.value.trim(),
      });

      /* ---- 7.7 Feedback + redirección ---- */
      mostrarAlerta('Inicio de sesión exitoso. Redirigiendo...', 'success');

      const destino = calcularDestino(data.usuario);
      redirigiendo = true;

      setTimeout(() => {
        // replace() en lugar de href → el login no queda en el historial
        window.location.replace(destino);
      }, 800);

    } catch (err) {
      /* ---- 7.8 Error de red ---- */
      mostrarAlerta('Error de conexión con el servidor. Intenta de nuevo.', 'error');

    } finally {
      /* ---- 7.9 Restaurar botón solo si NO estamos redirigiendo ---- */
      if (!redirigiendo) setCargando(false);
    }
  });

});