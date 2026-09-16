/* ============================================================
   LOGIN — Autenticación de usuarios GeoSteam
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
     6) DESTINO POST-LOGIN
     ========================================================== */
  function calcularDestino(usuario) {
  const params  = new URLSearchParams(window.location.search);
  const next    = params.get('next');
  const roles   = usuario?.roles || [];
  const esAdmin = roles.includes('ROLE_ADMIN');

  // Admin va directo al panel de administración; usuario normal al hub.
  let destino = esAdmin ? '/admin' : '/hub';

  // Si viene ?next=... respetamos ese destino (útil para login obligatorio)
  if (next) destino = next;

  return destino;
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
        window.location.href = destino;
      }, 1200);

    } catch (err) {
      /* ---- 7.8 Error de red ---- */
      mostrarAlerta('Error de conexión con el servidor. Intenta de nuevo.', 'error');

    } finally {
      /* ---- 7.9 Restaurar botón solo si NO estamos redirigiendo ---- */
      if (!redirigiendo) setCargando(false);
    }
  });

});