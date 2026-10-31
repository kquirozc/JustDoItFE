(() => {
  const $ = (id) => document.getElementById(id);
  const SESSION_KEY = 'justdoit.user';
  const STATUS_LABEL = { PENDING: 'Pendiente', INPROGRESS: 'En progreso', DONE: 'Hecha' };

  let currentUser = null;
  let users = [];
  let tasks = [];
  let editingUserId = null;
  let editingTaskId = null;
  let registerMode = false;

  // ---------- Utilidades ----------
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    children.flat().forEach((c) => node.append(c));
    return node;
  }

  function toast(msg, isError = false) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 3500);
  }

  async function guard(fn) {
    try { return await fn(); } catch (e) { toast(e.message, true); }
  }

  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : '-');
  const isAdmin = () => currentUser && currentUser.type === 'ADMIN';
  const targetUserId = () => currentUser.id;

  // ---------- Log ----------
  Api.onLog((e) => {
    const status = e.error ? el('span', { class: 'err' }, 'ERROR ' + e.error)
      : el('span', { class: e.status < 400 ? 'ok' : 'err' }, String(e.status));
    const lines = [`${e.method} ${e.url}`];
    if (e.body !== undefined) lines.push('→ ' + JSON.stringify(e.body));
    if (e.response !== undefined && e.response !== null) lines.push('← ' + JSON.stringify(e.response));
    $('log').prepend(el('div', { class: 'log-entry' }, new Date().toLocaleTimeString() + ' ', status, '\n' + lines.join('\n')));
  });
  $('log-clear').onclick = () => { $('log').textContent = ''; };

  // ---------- Login ----------
  $('show-register').onclick = (e) => {
    e.preventDefault();
    openUserDialog(null, true);
  };

  $('login-form').onsubmit = (e) => {
    e.preventDefault();
    guard(async () => {
      const name = $('login-username').value.trim();
      const response = await fetch(`http://localhost:8080/api/v1/users/byusername/${name}`);
      if (!response.ok) throw new Error('Usuario no encontrado');
      const found = await response.json();
      startSession(found);
    });
  };

  function startSession(user) {
    currentUser = user;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    $('login-view').classList.add('hidden');
    $('app-view').classList.remove('hidden');
    $('session-label').textContent = `${user.userName} (${user.type})`;
    document.querySelectorAll('.tab[data-tab="users"], .tab[data-tab="log"]')
      .forEach((b) => b.classList.toggle('hidden', !isAdmin()));
    showTab('tasks');
    guard(async () => {
      if (isAdmin()) await loadUsers();
      await loadTasks();
    });
  }

  $('logout').onclick = () => {
    sessionStorage.removeItem(SESSION_KEY);
    currentUser = null;
    $('app-view').classList.add('hidden');
    $('login-view').classList.remove('hidden');
    $('login-username').value = '';
  };

  // ---------- Tabs ----------
  function showTab(name) {
    if (name !== 'tasks' && !isAdmin()) name = 'tasks';
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + name));
  }
  document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

  // ---------- Usuarios ----------
  async function loadUsers() {
    users = await Api.users.list();
    renderUsers();
  }

  function renderUsers() {
    const body = $('user-rows');
    body.textContent = '';
    users.forEach((u) => {
      body.append(el('tr', {},
        el('td', {}, String(u.id)),
        el('td', {}, u.userName),
        el('td', {}, u.name || '-'),
        el('td', {}, u.email || '-'),
        el('td', {}, el('span', { class: 'badge ' + u.type }, u.type || '-')),
        el('td', {}, fmtDate(u.createdAt)),
        el('td', { class: 'actions-cell' },
          el('button', { class: 'btn ghost small', onclick: () => openUserDialog(u) }, 'Editar'), ' ',
          el('button', { class: 'btn danger small', onclick: () => deleteUser(u) }, 'Eliminar'))));
    });
  }

  function openUserDialog(user, fromLogin = false) {
    editingUserId = user ? user.id : null;
    registerMode = fromLogin;
    $('user-dialog-title').textContent = user ? 'Editar usuario' : 'Nuevo usuario';
    $('uf-username').value = user ? user.userName : '';
    $('uf-username').disabled = !!user;
    $('uf-name').value = user?.name || '';
    $('uf-email').value = user?.email || '';
    $('uf-type').value = user?.type || 'REGULAR';
    $('user-dialog').showModal();
  }

  $('user-new').onclick = () => openUserDialog(null);
  $('user-refresh').onclick = () => guard(loadUsers);

  $('user-form').onsubmit = (e) => {
    e.preventDefault();
    guard(async () => {
      const name = $('uf-name').value.trim();
      const email = $('uf-email').value.trim();
      const type = $('uf-type').value;
      if (editingUserId) {
        await Api.users.update(editingUserId, { name, email, type });
        toast('Usuario actualizado');
        $('user-dialog').close();
        await loadUsers();
      } else {
        const created = await Api.users.create({ userName: $('uf-username').value.trim(), name, email, type });
        toast('Usuario creado');
        $('user-dialog').close();
        if (registerMode) startSession(created); else await loadUsers();
      }
    });
  };

  async function deleteUser(u) {
    if (!confirm(`¿Eliminar al usuario ${u.userName}?`)) return;
    await guard(async () => {
      await Api.users.remove(u.id);
      toast('Usuario eliminado');
      if (u.id === currentUser.id) { $('logout').click(); return; }
      await loadUsers();
      await loadTasks();
    });
  }

  // ---------- Tareas ----------
  async function loadTasks() {
    tasks = await Api.tasks.list(targetUserId());
    renderTasks();
  }

  function renderTasks() {
    const list = $('task-list');
    const filter = $('task-filter').value;
    list.textContent = '';
    const shown = tasks.filter((t) => !filter || t.status === filter);
    if (!shown.length) { list.append(el('div', { class: 'empty' }, 'No hay tareas')); return; }

    shown.forEach((t) => {
      const select = el('select', { 'aria-label': 'Cambiar estado' },
          Object.entries(STATUS_LABEL).map(([v, l]) => el('option', { value: v }, l)));
      select.value = t.status;
      select.onchange = () => guard(async () => {
        await Api.tasks.update(targetUserId(), t.id, { status: select.value });
        await loadTasks();
      });

      // Definir el siguiente estado para el botón "Avanzar"
      let nextStatus = null;
      if (t.status === 'PENDING') {
        nextStatus = 'INPROGRESS';
      } else if (t.status === 'INPROGRESS') {
        nextStatus = 'DONE';
      }

      // Crear los elementos de acciones de manera limpia
      const actionsChildren = [];

      // Solo agregamos el botón Avanzar si existe un siguiente estado válido
      if (nextStatus) {
        actionsChildren.push(
            el('button', {
              class: 'btn ghost small',
              onclick: () => guard(async () => {
                await Api.tasks.update(targetUserId(), t.id, { status: nextStatus });
                toast('Estado de tarea actualizado');
                await loadTasks();
              })
            }, 'Avanzar')
        );
      }

      // Agregar los botones de Editar y Eliminar
      actionsChildren.push(
          el('button', { class: 'btn ghost small', onclick: () => openTaskDialog(t) }, 'Editar'),
          el('button', { class: 'btn danger small', onclick: () => deleteTask(t) }, 'Eliminar')
      );

      const actionsRow = el('div', { class: 'row' }, ...actionsChildren);

      list.append(el('article', { class: 'card task ' + t.status },
          el('div', { class: 'row' }, el('span', { class: 'badge ' + t.status }, STATUS_LABEL[t.status] || t.status),
              el('span', { class: 'meta' }, '#' + t.id)),
          el('p', {}, t.description || ''),
          el('div', { class: 'meta' }, 'Límite: ' + (t.deadline || '-') + ' · Creada: ' + fmtDate(t.createdAt)),
          select,
          actionsRow));
    });
  }

  function openTaskDialog(task) {
    editingTaskId = task ? task.id : null;
    $('task-dialog-title').textContent = task ? 'Editar tarea' : 'Nueva tarea';
    $('tf-description').value = task?.description || '';
    $('tf-status').value = task?.status || 'PENDING';
    $('tf-deadline').value = task?.deadline || '';
    $('task-dialog').showModal();
  }

  $('task-new').onclick = () => openTaskDialog(null);
  $('task-refresh').onclick = () => guard(loadTasks);
  $('task-filter').onchange = renderTasks;
  $('task-auto').onclick = () => guard(async () => {
    await Api.tasks.autogenerate(targetUserId());
    toast('Tarea aleatoria generada');
    await loadTasks();
  });

  $('task-form').onsubmit = (e) => {
    e.preventDefault();
    guard(async () => {
      const payload = { description: $('tf-description').value.trim(), status: $('tf-status').value };
      const deadline = $('tf-deadline').value;
      if (deadline) payload.deadline = deadline;
      if (editingTaskId) {
        await Api.tasks.update(targetUserId(), editingTaskId, payload);
        toast('Tarea actualizada');
      } else {
        await Api.tasks.create(targetUserId(), payload);
        toast('Tarea creada');
      }
      $('task-dialog').close();
      await loadTasks();
    });
  };

  async function deleteTask(t) {
    if (!confirm('¿Eliminar esta tarea?')) return;
    await guard(async () => {
      await Api.tasks.remove(targetUserId(), t.id);
      toast('Tarea eliminada');
      await loadTasks();
    });
  }

  document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => b.closest('dialog').close()));

  // Restaurar sesión
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (saved) { try { startSession(JSON.parse(saved)); } catch { /* sesión inválida */ } }
})();
