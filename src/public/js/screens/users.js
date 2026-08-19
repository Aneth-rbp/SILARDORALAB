/**
 * Users Screen - Administración de usuarios del sistema
 * Solo accesible para administradores
 */

class UsersScreen {
    constructor(app) {
        this.app = app;
        this.users = [];
        this.currentUser = this.app.userSession;
        this.currentPage = 1;
        this.itemsPerPage = 8;
        
        this.init();
    }

    destroy() {
        console.log('UsersScreen destroyed');
        // dispose() antes de remove(): si el modal sigue abierto, Bootstrap se
        // lleva su backdrop. Borrando solo el markup queda un div a pantalla
        // completa que bloquea todos los clicks de la aplicacion.
        // Todas las copias y no solo getElementById: el modal se muda al body
        // al abrirlo, asi que si la pantalla se repinta quedan dos elementos con
        // el mismo id y getElementById devuelve el del contenedor, dejando vivo
        // justo el del body -el que tiene la instancia y el que se queda como
        // capa invisible encima de la pantalla-.
        document.querySelectorAll('#userModal').forEach((modalElement) => {
            bootstrap.Modal.getInstance(modalElement)?.dispose();
            modalElement.remove();
        });
    }

    async init() {
        if (this.currentUser.role !== 'admin') {
            this.app.showError('Acceso denegado: Solo administradores');
            this.app.navigateToScreen('dashboard');
            return;
        }

        await this.loadUsers();
    }

    async loadUsers() {
        try {
            const response = await this.app.apiCall('/users');
            if (response.success) {
                this.users = response.users;
                this.render();
            }
        } catch (error) {
            this.app.showError('Error cargando usuarios');
        }
    }

    render() {
        const container = document.getElementById('screen-container');
        
        // Calcular paginación
        const totalPages = Math.ceil(this.users.length / this.itemsPerPage);
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const paginatedUsers = this.users.slice(startIndex, endIndex);

        container.innerHTML = `
            <div class="container-fluid py-4">
                <div class="d-flex justify-content-between align-items-center mb-4">
                    <div>
                        <h2 class="mb-1">
                            <i class="bi bi-people-fill me-2 text-primary"></i>
                            Administración de Usuarios
                        </h2>
                        <p class="text-muted">Gestione los accesos y permisos del sistema</p>
                    </div>
                    <button class="btn btn-primary" onclick="window.usersScreen.showUserModal()">
                        <i class="bi bi-person-plus me-2"></i>Nuevo Usuario
                    </button>
                </div>

                <div class="card shadow-sm border-0 overflow-hidden mb-4">
                    <div class="table-responsive">
                        <table class="table table-hover align-middle mb-0">
                            <thead class="bg-light">
                                <tr>
                                    <th class="ps-4">Usuario</th>
                                    <th>Nombre Completo</th>
                                    <th>Rol</th>
                                    <th>Último Acceso</th>
                                    <th class="text-end pe-4">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${paginatedUsers.length > 0 ? 
                                    paginatedUsers.map(user => this.renderUserRow(user)).join('') : 
                                    '<tr><td colspan="5" class="text-center py-4">No hay usuarios registrados</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Paginación -->
                ${totalPages > 1 ? `
                <nav class="d-flex justify-content-center">
                    <ul class="pagination pagination-rounded mb-0">
                        <li class="page-item ${this.currentPage === 1 ? 'disabled' : ''}">
                            <button class="page-link" onclick="window.usersScreen.changePage(${this.currentPage - 1})">
                                <i class="bi bi-chevron-left"></i>
                            </button>
                        </li>
                        
                        ${this.renderPaginationButtons(totalPages)}

                        <li class="page-item ${this.currentPage === totalPages ? 'disabled' : ''}">
                            <button class="page-link" onclick="window.usersScreen.changePage(${this.currentPage + 1})">
                                <i class="bi bi-chevron-right"></i>
                            </button>
                        </li>
                    </ul>
                </nav>
                ` : ''}
            </div>

            <!-- User Modal -->
            <div class="modal fade" id="userModal" tabindex="-1">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content border-0 shadow">
                        <div class="modal-header border-0 bg-primary text-white">
                            <h5 class="modal-title" id="userModalTitle">Nuevo Usuario</h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body p-4">
                            <form id="userForm">
                                <input type="hidden" id="userId">
                                <div class="mb-3">
                                    <label class="form-label fw-bold small text-uppercase">Username</label>
                                    <input type="text" class="form-control bg-light border-0" id="userName" required>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label fw-bold small text-uppercase">Nombre Completo</label>
                                    <input type="text" class="form-control bg-light border-0" id="userFullName" required>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label fw-bold small text-uppercase">Rol</label>
                                    <select class="form-select bg-light border-0" id="userRole" required>
                                        <option value="usuario">Usuario</option>
                                        <option value="admin">Administrador</option>
                                    </select>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label fw-bold small text-uppercase" id="passLabel">Contraseña</label>
                                    <input type="password" class="form-control bg-light border-0" id="userPassword">
                                    <div id="passHelp" class="form-text small">Dejar en blanco para no cambiar</div>
                                </div>
                            </form>
                        </div>
                        <div class="modal-footer border-0 p-4">
                            <button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancelar</button>
                            <button type="button" class="btn btn-primary px-4" onclick="window.usersScreen.saveUser()">Guardar</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        window.usersScreen = this;
    }

    renderUserRow(user) {
        const isSelf = user.id === this.currentUser.id;
        const lastLogin = user.last_login ? new Date(user.last_login).toLocaleString() : 'Nunca';
        const roleBadge = user.role === 'admin' ? 'bg-danger' : 'bg-primary';

        return `
            <tr>
                <td class="ps-4">
                    <div class="d-flex align-items-center">
                        <div class="avatar bg-light text-primary rounded-circle me-3 d-flex align-items-center justify-content-center" style="width: 40px; height: 40px;">
                            <i class="bi bi-person"></i>
                        </div>
                        <span class="fw-bold">${user.username}</span>
                    </div>
                </td>
                <td>${user.full_name}</td>
                <td>
                    <span class="badge ${roleBadge} rounded-pill">${user.role}</span>
                </td>
                <td class="small text-muted">${lastLogin}</td>
                <td class="text-end pe-4">
                    <button class="btn btn-sm btn-light me-1" onclick="window.usersScreen.showUserModal(${JSON.stringify(user).replace(/"/g, '&quot;')})" title="Editar">
                        <i class="bi bi-pencil"></i>
                    </button>
                    ${!isSelf ? `
                        <button class="btn btn-sm btn-light text-danger" onclick="window.usersScreen.deleteUser(${user.id}, '${user.username}')" title="Eliminar">
                            <i class="bi bi-trash"></i>
                        </button>
                    ` : '<span class="px-3"></span>'}
                </td>
            </tr>
        `;
    }

    showUserModal(user = null) {
        const modalElement = document.getElementById('userModal');
        if (!modalElement) return;

        if (modalElement.parentNode !== document.body) {
            // Eliminar cualquier modal viejo en el body antes de mover el nuevo
            const oldModal = document.querySelector('body > #userModal');
            if (oldModal && oldModal !== modalElement) {
                bootstrap.Modal.getInstance(oldModal)?.dispose();
                oldModal.remove();
            }
            document.body.appendChild(modalElement);
        }

        // El doble toque de la pantalla tactil llegaba dos veces: el segundo
        // reiniciaba el formulario con el modal ya abierto.
        if (modalElement.classList.contains('show')) return;

        let modal = bootstrap.Modal.getInstance(modalElement);
        if (!modal) {
            modal = new bootstrap.Modal(modalElement, { focus: false });
        }
        const form = document.getElementById('userForm');
        const passHelp = document.getElementById('passHelp');
        const passLabel = document.getElementById('passLabel');
        const usernameInput = document.getElementById('userName');

        form.reset();
        
        if (user) {
            document.getElementById('userModalTitle').innerText = 'Editar Usuario';
            document.getElementById('userId').value = user.id;
            usernameInput.value = user.username;
            usernameInput.disabled = true;
            document.getElementById('userFullName').value = user.full_name;
            document.getElementById('userRole').value = user.role;
            passHelp.style.display = 'block';
            passLabel.innerText = 'Nueva Contraseña (opcional)';
        } else {
            document.getElementById('userModalTitle').innerText = 'Nuevo Usuario';
            document.getElementById('userId').value = '';
            usernameInput.disabled = false;
            passHelp.style.display = 'none';
            passLabel.innerText = 'Contraseña';
            document.getElementById('userPassword').required = true;
        }

        modal.show();
    }

    async saveUser() {
        const id = document.getElementById('userId').value;
        const userData = {
            username: document.getElementById('userName').value,
            full_name: document.getElementById('userFullName').value,
            role: document.getElementById('userRole').value,
            password: document.getElementById('userPassword').value
        };

        if (!id && !userData.password) {
            this.app.showError('La contraseña es obligatoria');
            return;
        }

        try {
            const method = id ? 'PUT' : 'POST';
            const url = id ? `/users/${id}` : '/users';
            
            const response = await this.app.apiCall(url, {
                method: method,
                body: JSON.stringify(userData)
            });

            if (response.success) {
                bootstrap.Modal.getInstance(document.getElementById('userModal')).hide();
                this.app.showSuccess(response.message);
                await this.loadUsers();
            }
        } catch (error) {
            this.app.showError('Error guardando usuario');
        }
    }

    async deleteUser(id, username) {
        const eliminar = await confirmar(`¿Está seguro que desea eliminar al usuario "${username}"?`, {
            titulo: 'Eliminar usuario',
            aceptar: 'Eliminar',
            tipo: 'peligro'
        });

        if (!eliminar) return;

        try {
            const response = await this.app.apiCall(`/users/${id}`, {
                method: 'DELETE'
            });

            if (response.success) {
                this.app.showSuccess(response.message);
                await this.loadUsers();
            }
        } catch (error) {
            this.app.showError('Error eliminando usuario');
        }
    }

    changePage(page) {
        this.currentPage = page;
        this.render();
    }

    renderPaginationButtons(totalPages) {
        let buttons = '';
        for (let i = 1; i <= totalPages; i++) {
            buttons += `
                <li class="page-item ${this.currentPage === i ? 'active' : ''}">
                    <button class="page-link" onclick="window.usersScreen.changePage(${i})">${i}</button>
                </li>
            `;
        }
        return buttons;
    }

    static getTemplate() {
        return `
            <div id="users-screen-placeholder" class="py-4">
                <div class="text-center py-5">
                    <div class="spinner-border text-primary" role="status"></div>
                    <p class="mt-3">Cargando administración de usuarios...</p>
                </div>
            </div>
        `;
    }
}

window.UsersScreen = UsersScreen;
