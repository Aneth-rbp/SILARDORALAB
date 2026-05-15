/**
 * Configuration Screen - Configuración del sistema SILAR
 * Equivale a las pantallas 7 del diseño original
 * Solo administradores pueden modificar la configuración
 */

class ConfigurationScreen {
    constructor(app) {
        this.app = app;
        this.config = {};
        this.configData = {};
        this.isAdmin = false;
        this.init();
    }

    init() {
        this.checkAdminPermissions();
        this.loadConfiguration();
        this.bindEvents();
    }

    destroy() { }

    checkAdminPermissions() {
        // Verificar si el usuario actual es administrador
        this.isAdmin = this.app.userSession?.role === 'admin';

        if (!this.isAdmin) {
            console.warn('Usuario no es administrador - acceso de solo lectura');
        }
    }

    bindEvents() {
        // Usar delegación de eventos para asegurar que funcionen tras el renderizado
        document.addEventListener('click', (e) => {
            if (e.target.closest('#save-config-btn')) {
                this.saveConfiguration();
            }
            if (e.target.closest('#reset-config-btn')) {
                this.resetConfiguration();
            }
        });
    }

    async loadConfiguration() {
        try {
            const response = await this.app.apiCall('/config');

            if (response.success) {
                this.configData = response.config || {};
                this.config = {};

                // Convertir configuraciones agrupadas a objeto plano
                Object.values(this.configData).forEach(category => {
                    category.forEach(item => {
                        this.config[item.key] = item.value;
                    });
                });

                this.updateConfigurationForm();
            } else {
                if (response.message && response.message.includes('administradores')) {
                    this.showReadOnlyMessage();
                } else {
                    this.app.showError(response.message || 'Error cargando la configuración');
                }
            }
        } catch (error) {
            console.error('Error loading configuration:', error);
            this.app.showError('Error cargando la configuración');
        }
    }

    updateConfigurationForm() {
        const formFields = {
            'config-report-path': this.config.report_path || '',
            'config-max-velocity-y': this.config.max_velocity_y || 1000,
            'config-max-velocity-z': this.config.max_velocity_z || 1000,
            'config-max-accel-y': this.config.max_accel_y || 100,
            'config-max-accel-z': this.config.max_accel_z || 100,
            'config-humidity-offset': this.config.humidity_offset || 0,
            'config-temperature-offset': this.config.temperature_offset || 0
        };

        Object.entries(formFields).forEach(([fieldId, value]) => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.value = value;
                if (!this.isAdmin) {
                    field.disabled = true;
                    field.classList.add('bg-light');
                }
            }
        });

        const saveBtn = document.getElementById('save-config-btn');
        if (saveBtn) {
            saveBtn.disabled = !this.isAdmin;
            if (!this.isAdmin) {
                saveBtn.classList.add('opacity-50');
            }
        }
    }

    showReadOnlyMessage() {
        const configContainer = document.getElementById('config-container');
        if (configContainer) {
            configContainer.innerHTML = `
                <div class="alert alert-warning d-flex align-items-center" role="alert">
                    <i class="bi bi-shield-lock me-3" style="font-size: 2rem;"></i>
                    <div>
                        <h5 class="alert-heading mb-1">Acceso Restringido</h5>
                        <p class="mb-0">Solo los administradores pueden ver y modificar la configuración del sistema.</p>
                    </div>
                </div>
            `;
        }
    }

    async saveConfiguration() {
        if (!this.isAdmin) {
            this.app.showError('Solo los administradores pueden guardar la configuración');
            return;
        }

        const configToSave = {
            report_path: document.getElementById('config-report-path')?.value || '',
            max_velocity_y: parseFloat(document.getElementById('config-max-velocity-y')?.value) || 0,
            max_velocity_z: parseFloat(document.getElementById('config-max-velocity-z')?.value) || 0,
            max_accel_y: parseFloat(document.getElementById('config-max-accel-y')?.value) || 0,
            max_accel_z: parseFloat(document.getElementById('config-max-accel-z')?.value) || 0,
            humidity_offset: parseFloat(document.getElementById('config-humidity-offset')?.value) || 0,
            temperature_offset: parseFloat(document.getElementById('config-temperature-offset')?.value) || 0
        };

        const saveBtn = document.getElementById('save-config-btn');
        const originalContent = saveBtn.innerHTML;

        try {
            saveBtn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Guardando...';
            saveBtn.disabled = true;

            const response = await this.app.apiCall('/config', {
                method: 'PUT',
                body: JSON.stringify({ config: configToSave })
            });

            if (response.success) {
                this.app.showSuccess('Configuración guardada correctamente');
                await this.loadConfiguration();
            } else {
                throw new Error(response.message);
            }
        } catch (error) {
            this.app.showError(error.message || 'Error guardando la configuración');
        } finally {
            saveBtn.innerHTML = originalContent;
            saveBtn.disabled = false;
        }
    }

    resetConfiguration() {
        if (!this.isAdmin) return;
        if (confirm('¿Está seguro que desea restablecer los cambios?')) {
            this.loadConfiguration();
        }
    }

    static getTemplate() {
        return `
            <div class="configuration-container">
                <div class="row">
                    <div class="col-12 mb-3">
                        <h4 class="mb-1">
                            <i class="bi bi-gear me-2 text-primary"></i>
                            Configuración del Sistema
                        </h4>
                    </div>

                    <div class="col-12" id="config-container">
                        <div class="card shadow-sm border-0">
                            <div class="card-header bg-primary text-white py-2">
                                <h6 class="mb-0 small fw-bold">
                                    <i class="bi bi-sliders me-2"></i>Parámetros del Sistema
                                </h6>
                            </div>
                            <div class="card-body p-0">
                                <div class="config-scroll-wrapper p-4">
                                    <form id="configuration-form">
                                        <!-- Reportes -->
                                        <div class="row g-2 align-items-center mb-4">
                                            <div class="col-auto">
                                                <label class="form-label fw-bold small mb-0" style="min-width: 80px;">Reportes:</label>
                                            </div>
                                            <div class="col">
                                                <input type="text" class="form-control" id="config-report-path">
                                            </div>
                                        </div>

                                        <hr class="my-4 opacity-10">

                                        <!-- Velocidades y Aceleraciones -->
                                        <div class="row g-4 mb-4">
                                            <div class="col-md-3">
                                                <h6 class="text-primary fw-bold x-small mb-2">Vel. Y (rpm)</h6>
                                                <input type="number" class="form-control" id="config-max-velocity-y">
                                            </div>
                                            <div class="col-md-3">
                                                <h6 class="text-primary fw-bold x-small mb-2">Vel. Z (rpm)</h6>
                                                <input type="number" class="form-control" id="config-max-velocity-z">
                                            </div>
                                            <div class="col-md-3">
                                                <h6 class="text-primary fw-bold x-small mb-2">Accel. Y (rpm/s)</h6>
                                                <input type="number" class="form-control" id="config-max-accel-y">
                                            </div>
                                            <div class="col-md-3">
                                                <h6 class="text-primary fw-bold x-small mb-2">Accel. Z (rpm/s)</h6>
                                                <input type="number" class="form-control" id="config-max-accel-z">
                                            </div>
                                        </div>

                                        <hr class="my-4 opacity-10">

                                        <!-- Offsets -->
                                        <div class="row g-4">
                                            <div class="col-md-4">
                                                <h6 class="text-primary fw-bold x-small mb-2">Offset Humedad (%)</h6>
                                                <input type="number" step="0.1" class="form-control" id="config-humidity-offset">
                                            </div>
                                            <div class="col-md-4">
                                                <h6 class="text-primary fw-bold x-small mb-2">Offset Temp. (°C)</h6>
                                                <input type="number" step="0.1" class="form-control" id="config-temperature-offset">
                                            </div>
                                            <div class="col-md-4">
                                                <h6 class="text-primary fw-bold x-small mb-2">Sync (seg)</h6>
                                                <input type="number" class="form-control" value="5" readonly disabled>
                                            </div>
                                        </div>
                                    </form>
                                </div>
                                
                                <div class="card-footer bg-light p-3 d-flex justify-content-end gap-2">
                                    <button class="btn btn-outline-secondary" type="button" id="reset-config-btn">
                                        Restablecer
                                    </button>
                                    <button class="btn btn-primary px-5" type="button" id="save-config-btn">
                                        Guardar Cambios
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

window.ConfigurationScreen = ConfigurationScreen;
