document.addEventListener('DOMContentLoaded', () => {
const API_BASE = window.GEOSTEAM_API_BASE || '';
  const token = localStorage.getItem('geosteam_token');

  const toast         = document.getElementById('soonToast');
  const logoutBtn     = document.getElementById('logoutBtn');
  const btnGeoserver  = document.getElementById('btnGeoserver');

  const userInitEl = document.getElementById('userInitial');
  const userNameEl = document.getElementById('userName');
  const userRoleEl = document.getElementById('userRole');

  /* -------------------------------------------------------------
     Utilidades UI
     ------------------------------------------------------------- */
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let toastTimer = null;
  function mostrarToast(mensaje) {
    if (!toast) return;
    const textEl = toast.querySelector('.toast-text');
    if (textEl) textEl.textContent = mensaje;
    else toast.textContent = mensaje;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  // Pinta el user pill del topbar
  function pintarUsuario({ nombre, email, rol }) {
    const display = (nombre && nombre.trim())
                 || (email && email.trim())
                 || 'Usuario';
    const initial = (display.trim()[0] || '·').toUpperCase();

    if (userInitEl) userInitEl.textContent = initial;
    if (userNameEl) userNameEl.textContent = display;
    if (userRoleEl) userRoleEl.textContent = (rol || 'usuario').toLowerCase();
  }

  // Anima el valor de un KPI cuando llega del backend
  function setKpi(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
    el.classList.remove('is-loaded');
    // forzar reflow para reiniciar la animación
    void el.offsetWidth;
    el.classList.add('is-loaded');
  }

  // Reveal escalonado
  function activarReveals() {
    const reveals = document.querySelectorAll('.reveal');
    if (reduce) {
      reveals.forEach((el) => { el.style.opacity = '1'; el.style.transform = 'none'; });
      return;
    }
    reveals.forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(18px)';
      const delay = parseFloat(getComputedStyle(el).getPropertyValue('--delay')) || 0;
      setTimeout(() => {
        el.style.transition =
          'opacity .6s cubic-bezier(.2,.7,.2,1), transform .6s cubic-bezier(.2,.7,.2,1)';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, delay * 1000);
    });
  }

  // Halo radial en chips y KPI cards
  function activarHalo(selector, targetSel) {
    document.querySelectorAll(selector).forEach((card) => {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        const target = targetSel ? card.querySelector(targetSel) : card;
        if (target) {
          target.style.setProperty('--mx', x + '%');
          target.style.setProperty('--my', y + '%');
        }
      });
    });
  }

  /* -------------------------------------------------------------
     Botón "Abrir GeoServer"
     ------------------------------------------------------------- */
  if (btnGeoserver) {
    btnGeoserver.href = window.GEOSTEAM_GEOSERVER_ADMIN_URL
      || 'http://10.106.0.1:8080/geoserver/web/';
  }

  /* -------------------------------------------------------------
     Chips "próximamente"
     ------------------------------------------------------------- */
  document.querySelectorAll('.is-soon').forEach((chip) => {
    chip.addEventListener('click', () => {
      mostrarToast(
        (chip.getAttribute('data-soon') || 'Esta sección') +
        ' estará disponible próximamente.'
      );
    });
  });

  /* -------------------------------------------------------------
     Logout
     ------------------------------------------------------------- */
  function cerrarSesion(redirectTo) {
    localStorage.removeItem('auth_session');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userName');
    localStorage.removeItem('userRole');
    localStorage.removeItem('geosteam_token');
    localStorage.removeItem('userRoles');
    localStorage.removeItem('userWorkspaces');
    window.location.href = redirectTo || '/';
  }

  if (logoutBtn) logoutBtn.addEventListener('click', () => cerrarSesion('/'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarSesion('/');
  });

  if (!token) {
    cerrarSesion('/login?next=/admin');
    return;
  }

  /* -------------------------------------------------------------
     Headers autenticados
     ------------------------------------------------------------- */
  function authHeaders() {
    return {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    };
  }

  /* -------------------------------------------------------------
     Verificar sesión + rol admin
     ------------------------------------------------------------- */
  let currentUser = null;

  // Pintado inmediato con lo que haya en localStorage
  pintarUsuario({
    nombre: localStorage.getItem('userName') || '',
    email:  localStorage.getItem('userEmail') || '',
    rol:    localStorage.getItem('userRole') || 'admin',
  });

  fetch(API_BASE + '/api/me', { headers: authHeaders() })
    .then((res) => {
      if (!res.ok) throw new Error('sesión inválida');
      return res.json();
    })
    .then((user) => {
      currentUser = user;

      // Compatibilidad con distintos formatos de backend
      const roles = user.roles
        || (user.role ? [`ROLE_${String(user.role).toUpperCase()}`] : []);

      if (!roles.includes('ROLE_ADMIN')) {
        window.location.href = '/hub';
        return;
      }

      pintarUsuario({
        nombre: user.full_name || user.name || user.username || '',
        email:  user.email || '',
        rol:    'admin',
      });

      if (user.full_name) localStorage.setItem('userName', user.full_name);

      cargarUsuarios();
      cargarEstadisticas(document.getElementById('rangoDias').value);
    })
    .catch(() => cerrarSesion('/login?next=/admin'));

  /* -------------------------------------------------------------
     Usuarios: listar / crear / editar / eliminar
     ------------------------------------------------------------- */
  const usersTableBody = document.getElementById('usersTableBody');
  const usersError = document.getElementById('usersError');
  const kpiUsuarios = document.getElementById('kpiUsuarios');
  const kpiAdmins = document.getElementById('kpiAdmins');

  function mostrarErrorUsuarios(msg) {
    if (!usersError) return;
    usersError.textContent = msg;
    usersError.classList.remove('d-none');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function inicialesDe(nombre) {
    if (!nombre) return '?';
    const partes = nombre.trim().split(/\s+/);
    const ini = partes.length > 1 ? partes[0][0] + partes[1][0] : partes[0].slice(0, 2);
    return ini.toUpperCase();
  }

  function renderRoles(roles) {
    if (!roles || roles.length === 0) return '—';
    return roles.map((r) => {
      const esAdmin = r === 'ROLE_ADMIN' || r === 'admin';
      const clase = esAdmin ? 'role-admin' : 'role-lector';
      const etiqueta = esAdmin ? 'Administrador' : 'Usuario';
      return `<span class="role-tag ${clase}">${escapeHtml(etiqueta)}</span>`;
    }).join(' ');
  }

  function renderWorkspaces(workspaces) {
    if (!workspaces || workspaces.length === 0) return '—';
    return workspaces.map((w) => `<span class="ws-tag">${escapeHtml(w)}</span>`).join(' ');
  }

  let usuariosCache = [];

  function pintarUsuarios(usuarios) {
    usuariosCache = usuarios;

    if (!usuarios.length) {
      usersTableBody.innerHTML = '<tr><td colspan="4" style="color:var(--mist);">Todavía no hay usuarios registrados.</td></tr>';
      return;
    }

    usersTableBody.innerHTML = usuarios.map((u, i) => {
      const esUnoMismo = currentUser && currentUser.id === u.id;
      return `
        <tr data-id="${u.id}" style="animation-delay:${i * 40}ms">
          <td>
            <div class="user-info">
              <div class="user-avatar">${escapeHtml(inicialesDe(u.nombre))}</div>
              <div class="user-name">${escapeHtml(u.nombre)}</div>
              <div class="user-email">${escapeHtml(u.email)}</div>
            </div>
          </td>
          <td>${renderRoles(u.roles)}</td>
          <td>${renderWorkspaces(u.workspaces)}</td>
          <td class="text-end">
            <span class="row-actions">
              <button class="row-action btn-editar" data-id="${u.id}" title="Editar usuario">✎</button>
              ${!esUnoMismo
                ? `<button class="row-action btn-eliminar" data-id="${u.id}" title="Eliminar usuario">✕</button>`
                : `<span style="color: #93A6BC; font-size: 0.75rem; font-family: 'IBM Plex Mono', monospace; align-self:center;">(Tú)</span>`}
            </span>
          </td>
        </tr>`;
    }).join('');

    usersTableBody.querySelectorAll('.btn-eliminar').forEach((btn) => {
      btn.addEventListener('click', () => eliminarUsuario(btn.getAttribute('data-id')));
    });
    usersTableBody.querySelectorAll('.btn-editar').forEach((btn) => {
      btn.addEventListener('click', () => abrirModalEditar(btn.getAttribute('data-id')));
    });
  }

  function cargarUsuarios() {
    fetch(API_BASE + '/api/users', { headers: authHeaders() })
      .then((res) => {
        if (!res.ok) throw new Error('No se pudo cargar la lista de usuarios');
        return res.json();
      })
      .then((data) => {
        const lista = data.usuarios || [];
        pintarUsuarios(lista);
        setKpi('kpiUsuarios', data.total ?? lista.length);
        const admins = lista.filter((u) => (u.roles || []).some((r) => r === 'ROLE_ADMIN' || r === 'admin')).length;
        setKpi('kpiAdmins', admins);
      })
      .catch((err) => {
        usersTableBody.innerHTML = '<tr><td colspan="4" style="color:var(--mist);">No se pudieron cargar los usuarios.</td></tr>';
        mostrarErrorUsuarios(err.message || 'Error al cargar usuarios');
      });
  }

  function eliminarUsuario(id) {
    if (!window.confirm('¿Eliminar este usuario? Esta acción no se puede deshacer.')) return;
    fetch(API_BASE + '/api/users/' + id, { method: 'DELETE', headers: authHeaders() })
      .then((res) => {
        if (!res.ok && res.status !== 204) throw new Error('No se pudo eliminar el usuario');
        cargarUsuarios();
      })
      .catch((err) => mostrarErrorUsuarios(err.message));
  }

  /* -------------------------------------------------------------
     Crear usuario
     ------------------------------------------------------------- */
  const formNuevoUsuario = document.getElementById('formNuevoUsuario');
  const createUserError = document.getElementById('createUserError');
  const btnCrearUsuario = document.getElementById('btnCrearUsuario');

  let workspacesDisponibles = null;

  async function obtenerWorkspacesDisponibles() {
    if (workspacesDisponibles) return workspacesDisponibles;
    const response = await fetch(API_BASE + '/api/workspaces', { headers: authHeaders() });
    if (!response.ok) throw new Error('Error al cargar workspaces');
    const data = await response.json();
    workspacesDisponibles = Array.isArray(data) ? data : data.workspaces || [];
    return workspacesDisponibles;
  }

  function renderWorkspacePicker(container, workspaces, seleccionados) {
    if (!container) return;
    if (!workspaces.length) {
      container.innerHTML = '<span class="ws-picker-msg">No hay espacios disponibles</span>';
      return;
    }
    const sel = new Set(seleccionados || []);
    container.innerHTML = workspaces.map((ws) => {
      const nombre = ws.name;
      const marcado = sel.has(nombre);
      return `
        <label class="ws-option${marcado ? ' is-checked' : ''}">
          <input type="checkbox" value="${escapeHtml(nombre)}" ${marcado ? 'checked' : ''}>
          <span class="ws-option-dot"></span>
          <span class="ws-option-label">${escapeHtml(nombre)}</span>
        </label>`;
    }).join('');

    container.querySelectorAll('.ws-option').forEach((label) => {
      const checkbox = label.querySelector('input[type="checkbox"]');
      checkbox.addEventListener('change', () => {
        label.classList.toggle('is-checked', checkbox.checked);
        container.classList.remove('is-invalid');
      });
    });
  }

  function workspacesSeleccionadosDe(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map((c) => c.value);
  }

  async function cargarWorkspacesPicker(container, seleccionados) {
    if (!container) return;
    container.innerHTML = '<span class="ws-picker-msg">Cargando espacios…</span>';
    try {
      const workspaces = await obtenerWorkspacesDisponibles();
      renderWorkspacePicker(container, workspaces, seleccionados);
    } catch (error) {
      console.error('Error cargando workspaces:', error);
      container.innerHTML = '<span class="ws-picker-msg">Error al cargar espacios</span>';
    }
  }

  const nuevoWorkspacePicker = document.getElementById('nuevoWorkspacePicker');

  const modalNuevoUsuario = document.getElementById('modalNuevoUsuario');
  if (modalNuevoUsuario) {
    modalNuevoUsuario.addEventListener('show.bs.modal', function () {
      const form = document.getElementById('formNuevoUsuario');
      if (form) {
        form.reset();
        form.querySelectorAll('input').forEach((input) => { input.value = ''; });
        form.querySelectorAll('select').forEach((select) => { select.selectedIndex = 0; });
      }
      const errorDiv = document.getElementById('createUserError');
      if (errorDiv) { errorDiv.classList.add('d-none'); errorDiv.textContent = ''; }

      const btnCrear = document.getElementById('btnCrearUsuario');
      if (btnCrear) { btnCrear.disabled = false; btnCrear.textContent = 'Crear usuario'; }

      cargarWorkspacesPicker(nuevoWorkspacePicker, []);
    });
  }

  if (formNuevoUsuario) {
    formNuevoUsuario.addEventListener('submit', (e) => {
      e.preventDefault();
      createUserError.classList.add('d-none');
      btnCrearUsuario.disabled = true;
      btnCrearUsuario.textContent = 'Creando…';

      const rolSeleccionado = document.getElementById('nuevoRol').value;
      const workspacesSeleccionados = workspacesSeleccionadosDe(nuevoWorkspacePicker);

      const roles = rolSeleccionado === 'admin' ? ['ROLE_ADMIN'] : ['ROLE_LECTOR'];

      if (workspacesSeleccionados.length === 0) {
        createUserError.textContent = 'Selecciona al menos un espacio de trabajo';
        createUserError.classList.remove('d-none');
        nuevoWorkspacePicker.classList.add('is-invalid');
        btnCrearUsuario.disabled = false;
        btnCrearUsuario.textContent = 'Crear usuario';
        return;
      }

      const payload = {
        nombre: document.getElementById('nuevoNombre').value.trim(),
        email: document.getElementById('nuevoEmail').value.trim(),
        password: document.getElementById('nuevoPassword').value,
        roles,
        workspaces: workspacesSeleccionados,
      };

      fetch(API_BASE + '/api/users', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.detail || 'No se pudo crear el usuario');
          return data;
        })
        .then(() => {
          formNuevoUsuario.reset();
          const modalEl = document.getElementById('modalNuevoUsuario');
          const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
          modal.hide();
          cargarUsuarios();
        })
        .catch((err) => {
          createUserError.textContent = err.message;
          createUserError.classList.remove('d-none');
        })
        .finally(() => {
          btnCrearUsuario.disabled = false;
          btnCrearUsuario.textContent = 'Crear usuario';
        });
    });
  }

  /* -------------------------------------------------------------
     Editar usuario
     ------------------------------------------------------------- */
  const formEditarUsuario = document.getElementById('formEditarUsuario');
  const editUserError = document.getElementById('editUserError');
  const btnGuardarEdicion = document.getElementById('btnGuardarEdicion');
  const editarWorkspacePicker = document.getElementById('editarWorkspacePicker');
  const modalEditarUsuarioEl = document.getElementById('modalEditarUsuario');
  const modalEditarUsuario = modalEditarUsuarioEl ? new bootstrap.Modal(modalEditarUsuarioEl) : null;

  function abrirModalEditar(userId) {
    const usuario = usuariosCache.find((u) => String(u.id) === String(userId));
    if (!usuario || !modalEditarUsuario) return;

    editUserError.classList.add('d-none');
    editUserError.textContent = '';
    btnGuardarEdicion.disabled = false;
    btnGuardarEdicion.textContent = 'Guardar cambios';

    document.getElementById('editarUserId').value = usuario.id;
    document.getElementById('editarNombre').value = usuario.nombre || '';
    document.getElementById('editarEmail').value = usuario.email || '';
    document.getElementById('editarPassword').value = '';
    document.getElementById('editarRol').value =
      (usuario.roles || []).some((r) => r === 'ROLE_ADMIN' || r === 'admin') ? 'admin' : 'usuario';

    cargarWorkspacesPicker(editarWorkspacePicker, usuario.workspaces || []);
    modalEditarUsuario.show();
  }

  if (formEditarUsuario) {
    formEditarUsuario.addEventListener('submit', (e) => {
      e.preventDefault();
      editUserError.classList.add('d-none');
      btnGuardarEdicion.disabled = true;
      btnGuardarEdicion.textContent = 'Guardando…';

      const userId = document.getElementById('editarUserId').value;
      const rolSeleccionado = document.getElementById('editarRol').value;
      const workspacesSeleccionados = workspacesSeleccionadosDe(editarWorkspacePicker);

      if (workspacesSeleccionados.length === 0) {
        editUserError.textContent = 'Selecciona al menos un espacio de trabajo';
        editUserError.classList.remove('d-none');
        editarWorkspacePicker.classList.add('is-invalid');
        btnGuardarEdicion.disabled = false;
        btnGuardarEdicion.textContent = 'Guardar cambios';
        return;
      }

      const payload = {
        nombre: document.getElementById('editarNombre').value.trim(),
        email: document.getElementById('editarEmail').value.trim(),
        roles: rolSeleccionado === 'admin' ? ['ROLE_ADMIN'] : ['ROLE_LECTOR'],
        workspaces: workspacesSeleccionados,
      };
      const nuevaPassword = document.getElementById('editarPassword').value;
      if (nuevaPassword) payload.password = nuevaPassword;

      fetch(API_BASE + '/api/users/' + userId, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.detail || 'No se pudo actualizar el usuario');
          return data;
        })
        .then(() => {
          modalEditarUsuario.hide();
          cargarUsuarios();
        })
        .catch((err) => {
          editUserError.textContent = err.message;
          editUserError.classList.remove('d-none');
        })
        .finally(() => {
          btnGuardarEdicion.disabled = false;
          btnGuardarEdicion.textContent = 'Guardar cambios';
        });
    });
  }

  /* -------------------------------------------------------------
     Estadísticas
     ------------------------------------------------------------- */
  const kpiVisitasHoy = document.getElementById('kpiVisitasHoy');
  const kpiVisitasTotal = document.getElementById('kpiVisitasTotal');
  const topPaginas = document.getElementById('topPaginas');
  const rangoDiasSelect = document.getElementById('rangoDias');
  let visitsChart = null;

  function cargarEstadisticas(dias) {
    fetch(API_BASE + '/api/stats/visits?days=' + dias, { headers: authHeaders() })
      .then((res) => {
        if (!res.ok) throw new Error('No se pudieron cargar las estadísticas');
        return res.json();
      })
      .then((data) => {
        setKpi('kpiVisitasHoy', data.total_hoy);
        setKpi('kpiVisitasTotal', data.total_historico);
        pintarGrafico(data.serie);
        pintarTopPaginas(data.paginas_top);
      })
      .catch(() => {
        setKpi('kpiVisitasHoy', '—');
        setKpi('kpiVisitasTotal', '—');
        if (topPaginas) topPaginas.innerHTML = '<li>No se pudieron cargar las estadísticas.</li>';
      });
  }

  function pintarGrafico(serie) {
    const canvas = document.getElementById('visitsChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const labels = serie.map((p) => {
      const d = new Date(p.fecha + 'T00:00:00');
      return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });
    });
    const valores = serie.map((p) => p.visitas);

    if (visitsChart) {
      visitsChart.data.labels = labels;
      visitsChart.data.datasets[0].data = valores;
      visitsChart.update();
      return;
    }

    visitsChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Visitas',
          data: valores,
          borderColor: '#4ECDC4',
          backgroundColor: 'rgba(78,205,196,0.15)',
          tension: 0.35,
          fill: true,
          pointRadius: 3,
          pointBackgroundColor: '#4ECDC4',
          pointBorderColor: '#0B1A2E',
          pointBorderWidth: 2,
          pointHoverRadius: 5,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: reduce ? 0 : 900,
          easing: 'easeOutCubic',
        },
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { color: '#93A6BC' },
            grid: { color: 'rgba(255,255,255,0.06)' },
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#93A6BC', precision: 0 },
            grid: { color: 'rgba(255,255,255,0.06)' },
          },
        },
      },
    });
  }

  function pintarTopPaginas(paginas) {
    if (!topPaginas) return;
    if (!paginas || !paginas.length) {
      topPaginas.innerHTML = '<li class="top-page-skeleton">Aún no hay visitas registradas.</li>';
      return;
    }
    topPaginas.innerHTML = paginas.map((p, i) => `
      <li class="d-flex justify-content-between align-items-center py-2 reveal"
          style="border-bottom:1px solid var(--line); --delay:${0.05 * i}s;">
        <span>${escapeHtml(p.path)}</span>
        <span class="font-mono" style="color:var(--teal);">${p.total}</span>
      </li>
    `).join('');
    activarReveals();
  }

  if (rangoDiasSelect) {
    rangoDiasSelect.addEventListener('change', () => cargarEstadisticas(rangoDiasSelect.value));
  }

  /* -------------------------------------------------------------
     Animaciones globales
     ------------------------------------------------------------- */
  activarReveals();
  activarHalo('.kpi-card');
  activarHalo('.access-chip');
});