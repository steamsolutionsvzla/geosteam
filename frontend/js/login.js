document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const emailError = document.getElementById('emailError');
  const passwordError = document.getElementById('passwordError');
  const togglePassword = document.getElementById('togglePass');
  const btnLogin = document.getElementById('btnLogin');
  const alertBox = document.getElementById('alertBox');
  const API_BASE = window.GEOSTEAM_API_BASE || '';

  // Mostrar / ocultar contraseña
  if (togglePassword) {
    togglePassword.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      togglePassword.textContent = isPassword ? '🙈' : '👁';
    });
  }

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
    alertBox.textContent = mensaje;
    alertBox.className = `alert show ${tipo}`;
    alertBox.style.display = 'block';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

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

    btnLogin.disabled = true;
    btnLogin.innerHTML = 'Iniciando...';
    mostrarAlerta('', '');

    try {
      const response = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailInput.value.trim(),
          password: passwordInput.value
        })
      });

      const data = await response.json();

      if (response.ok) {
        let token = data.access_token || data.token;
        if (!token) {
          mostrarAlerta('Error interno: No se recibió token de acceso.', 'error');
          btnLogin.disabled = false;
          btnLogin.innerHTML = 'Iniciar sesión';
          return;
        }

        // 🔥 Limpiar prefijo "Bearer " si existe
        if (typeof token === 'string' && token.startsWith('Bearer ')) {
          token = token.slice(7);
        }
        token = token.trim();

        localStorage.setItem('geosteam_token', token);
        localStorage.setItem('auth_session', 'activo');
        localStorage.setItem('userEmail', emailInput.value.trim());

        if (data.usuario) {
          localStorage.setItem('userRoles', JSON.stringify(data.usuario.roles || []));
          localStorage.setItem('userWorkspaces', JSON.stringify(data.usuario.workspaces || []));
        }

        mostrarAlerta('Inicio de sesión exitoso. Redirigiendo...', 'success');

        const params = new URLSearchParams(window.location.search);
        const next = params.get('next');
        const roles = data.usuario?.roles || [];
        let destino = 'hub.html';

        if (roles.includes('ROLE_ADMIN')) {
          destino = 'admin.html';
        } else if (next) {
          destino = next;
        }

        setTimeout(() => {
          window.location.href = `./${destino}`;
        }, 1500);
      } else {
        const mensajeError = data.detail || 'Credenciales incorrectas';
        mostrarAlerta(mensajeError, 'error');
      }
    } catch (err) {
      mostrarAlerta('Error de conexión con el servidor. Intenta de nuevo.', 'error');
    } finally {
      btnLogin.disabled = false;
      btnLogin.innerHTML = 'Iniciar sesión';
    }
  });
});