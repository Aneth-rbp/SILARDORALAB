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

    checkAdminPermissions() {
        // Verificar si el usuario actual es administrador
        this.isAdmin = this.app.userSession?.role === 'admin';
        
        if (!this.isAdmin) {
            console.warn('Usuario no es administrador - acceso de solo lectura');
        }
    }

    bindEvents() {
        // Save configuration button
        document.getElementById('save-config-btn')?.addEventListener('click', () => {
            this.saveConfiguration();
        });

        // Reset configuration button
        document.getElementById('reset-config-btn')?.addEventListener('click', () => {
            this.resetConfiguration();
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
                    // Usuario no es admin - mostrar mensaje
                    this.showReadOnlyMessage();
                } else {
                    this.app.showError(response.message || 'Error cargando la configuración');
                }
            }
        } catch (error) {
            console.error('Error loading configuration:', error);
            if (error.message && error.message.includes('403')) {
                this.showReadOnlyMessage();
            } else {
                this.app.showError('Error cargando la configuración');
            }
        }
    }

    updateConfigurationForm() {
        // Actualizar campos del formulario con la configuración actual
        const formFields = {
            'config-report-path': this.config.report_path || '',
            'config-max-velocity-y': this.config.max_velocity_y || this.config.velocity_y_max || 0,
            'config-max-velocity-z': this.config.max_velocity_z || this.config.velocity_z_max || 0,
            'config-max-accel-y': this.config.max_accel_y || this.config.accel_y_max || 0,
            'config-max-accel-z': this.config.max_accel_z || this.config.accel_z_max || 0,
            'config-humidity-offset': this.config.humidity_offset || 0,
            'config-temperature-offset': this.config.temperature_offset || 0
        };

        Object.entries(formFields).forEach(([fieldId, value]) => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.value = value;
                // Deshabilitar si no es admin
                if (!this.isAdmin) {
                    field.disabled = true;
                    field.classList.add('bg-light');
                }
            }
        });

        // Deshabilitar botón de guardar si no es admin
        const saveBtn = document.getElementById('save-config-btn');
        if (saveBtn) {
            saveBtn.disabled = !this.isAdmin;
            if (!this.isAdmin) {
                saveBtn.classList.add('opacity-50');
                saveBtn.title = 'Solo los administradores pueden guardar cambios';
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
                        <p class="mb-0 small">Su rol actual: <strong>${this.app.userSession?.role || 'Usuario'}</strong></p>
                    </div>
                </div>
            `;
        }
    }

    async saveConfiguration() {
        // Verificar permisos antes de guardar
        if (!this.isAdmin) {
            this.app.showError('Solo los administradores pueden guardar la configuración');
            return;
        }

        // Recopilar valores del formulario
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
        const originalText = saveBtn?.textContent;

        try {
            // Mostrar loading
            if (saveBtn) {
                saveBtn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Guardando...';
                saveBtn.disabled = true;
            }

            const response = await this.app.apiCall('/config', {
                method: 'PUT',
                body: JSON.stringify({ config: configToSave })
            });

            if (response.success) {
                this.app.showSuccess('Configuración guardada correctamente');
                // Recargar configuración para asegurar sincronización
                await this.loadConfiguration();
            } else {
                throw new Error(response.message || 'Error guardando la configuración');
            }
        } catch (error) {
            console.error('Error guardando configuración:', error);
            const errorMessage = error.message && error.message !== 'API Error: 403' 
                ? error.message 
                : 'Error guardando la configuración';
            this.app.showError(errorMessage);
        } finally {
            // Restaurar botón
            if (saveBtn) {
                saveBtn.innerHTML = originalText;
                saveBtn.disabled = false;
            }
        }
    }

    resetConfiguration() {
        if (!this.isAdmin) {
            this.app.showError('Solo los administradores pueden modificar la configuración');
            return;
        }

        if (confirm('¿Está seguro que desea restablecer los cambios no guardados?')) {
            this.loadConfiguration();
            this.app.showSuccess('Cambios restablecidos');
        }
    }

    static getTemplate() {
        return `
            <div class="configuration-container">
                <div class="row">
                    <div class="col-12 mb-4">
                        <h3 class="mb-1">
                            <i class="bi bi-gear me-2 text-primary"></i>
                            Configuración del Sistema
                        </h3>
                        <p class="text-muted mb-0">Ajustes y parámetros del sistema SILAR (Solo Administradores)</p>
                    </div>

                    <div class="col-12" id="config-container">
                        <div class="card">
                            <div class="card-header bg-primary text-white">
                                <h6 class="mb-0">
                                    <i class="bi bi-sliders me-2"></i>
                                    Parámetros del Sistema
                                </h6>
                            </div>
                            <div class="card-body">
                                <form id="configuration-form">
                                    <!-- Dirección para guardar reportes -->
                                    <div class="mb-4">
                                        <label for="config-report-path" class="form-label fw-bold">
                                            <i class="bi bi-folder me-2"></i>
                                            Dirección para guardar reportes
                                        </label>
                                        <input 
                                            type="text" 
                                            class="form-control form-control-lg" 
                                            id="config-report-path" 
                                            name="report_path"
                                            placeholder="C:\\SILAR\\Reportes"
                                            autocomplete="off"
                                        >
                                        <small class="text-muted">Ruta donde se guardarán los reportes del sistema</small>
                                    </div>

                                    <hr class="my-4">

                                    <!-- Velocidades Máximas -->
                                    <h6 class="fw-bold text-primary mb-3">
                                        <i class="bi bi-speedometer2 me-2"></i>
                                        Velocidades Máximas
                                    </h6>
                                    <div class="row g-3 mb-4">
                                        <div class="col-md-6">
                                            <label for="config-max-velocity-y" class="form-label">Velocidad máxima Y</label>
                                            <div class="input-group">
                                                <input 
                                                    type="number" 
                                                    class="form-control" 
                                                    id="config-max-velocity-y" 
                                                    name="max_velocity_y"
                                                    step="0.1"
                                                    min="0"
                                                    autocomplete="off"
                                                >
                                                <span class="input-group-text">rpm</span>
                                            </div>
                                        </div>
                                        <div class="col-md-6">
                                            <label for="config-max-velocity-z" class="form-label">Velocidad máxima Z</label>
                                            <div class="input-group">
                                                <input 
                                                    type="number" 
                                                    class="form-control" 
                                                    id="config-max-velocity-z" 
                                                    name="max_velocity_z"
                                                    step="0.1"
                                                    min="0"
                                                    autocomplete="off"
                                                >
                                                <span class="input-group-text">rpm</span>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Aceleraciones Máximas -->
                                    <h6 class="fw-bold text-primary mb-3">
                                        <i class="bi bi-graph-up-arrow me-2"></i>
                                        Aceleraciones Máximas
                                    </h6>
                                    <div class="row g-3 mb-4">
                                        <div class="col-md-6">
                                            <label for="config-max-accel-y" class="form-label">Aceleración máxima Y</label>
                                            <div class="input-group">
                                                <input 
                                                    type="number" 
                                                    class="form-control" 
                                                    id="config-max-accel-y" 
                                                    name="max_accel_y"
                                                    step="0.1"
                                                    min="0"
                                                    autocomplete="off"
                                                >
                                                <span class="input-group-text">rpm/s</span>
                                            </div>
                                        </div>
                                        <div class="col-md-6">
                                            <label for="config-max-accel-z" class="form-label">Aceleración máxima Z</label>
                                            <div class="input-group">
                                                <input 
                                                    type="number" 
                                                    class="form-control" 
                                                    id="config-max-accel-z" 
                                                    name="max_accel_z"
                                                    step="0.1"
                                                    min="0"
                                                    autocomplete="off"
                                                >
                                                <span class="input-group-text">rpm/s</span>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Offsets -->
                                    <h6 class="fw-bold text-primary mb-3">
                                        <i class="bi bi-thermometer-half me-2"></i>
                                        Offsets de Sensores
                                    </h6>
                                    <div class="row g-3 mb-4">
                                        <div class="col-md-6">
                                            <label for="config-humidity-offset" class="form-label">Offset Humedad</label>
                                            <div class="input-group">
                                                <input 
                                                    type="number" 
                                                    class="form-control" 
                                                    id="config-humidity-offset" 
                                                    name="humidity_offset"
                                                    step="0.1"
                                                    autocomplete="off"
                                                >
                                                <span class="input-group-text">%</span>
                                            </div>
                                        </div>
                                        <div class="col-md-6">
                                            <label for="config-temperature-offset" class="form-label">Offset Temperatura</label>
                                            <div class="input-group">
                                                <input 
                                                    type="number" 
                                                    class="form-control" 
                                                    id="config-temperature-offset" 
                                                    name="temperature_offset"
                                                    step="0.1"
                                                    autocomplete="off"
                                                >
                                                <span class="input-group-text">°C</span>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Botones de acción -->
                                    <div class="row g-3 mt-4">
                                        <div class="col-md-6">
                                            <button 
                                                type="button" 
                                                class="btn btn-primary btn-touch w-100" 
                                                id="save-config-btn"
                                            >
                                                <i class="bi bi-save me-2"></i>
                                                Guardar Cambios
                                            </button>
                                        </div>
                                        <div class="col-md-6">
                                            <button 
                                                type="button" 
                                                class="btn btn-outline-secondary btn-touch w-100" 
                                                id="reset-config-btn"
                                            >
                                                <i class="bi bi-arrow-clockwise me-2"></i>
                                                Restablecer
                                            </button>
                                        </div>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

// Register the screen globally
window.ConfigurationScreen = ConfigurationScreen;
