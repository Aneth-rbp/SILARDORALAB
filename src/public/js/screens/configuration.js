/**
 * Configuration Screen - Configuración del sistema SILAR
 * Equivale a las pantallas 7 del diseño original
 */

class ConfigurationScreen {
    constructor(app) {
        this.app = app;
        this.config = {};
        this.init();
    }

    init() {
        this.loadConfiguration();
        this.bindEvents();
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
            this.config = await this.app.apiCall('/config');
            this.updateConfigurationForm();
        } catch (error) {
            console.error('Error loading configuration:', error);
        }
    }

    updateConfigurationForm() {
        // Update form fields with current configuration
        console.log('Configuration loaded:', this.config);
    }

    async saveConfiguration() {
        try {
            await this.app.apiCall('/config', {
                method: 'PUT',
                body: JSON.stringify(this.config)
            });
            
            this.app.showSuccess('Configuración guardada correctamente');
            
        } catch (error) {
            this.app.showError('Error guardando la configuración');
        }
    }

    resetConfiguration() {
        if (confirm('¿Está seguro que desea restablecer la configuración?')) {
            this.loadConfiguration();
            this.app.showSuccess('Configuración restablecida');
        }
    }

    static getTemplate() {
        return `
            <div class="row">
                <div class="col-12 mb-4">
                    <h3 class="mb-1">
                        <i class="bi bi-gear me-2 text-primary"></i>
                        Configuración del Sistema
                    </h3>
                    <p class="text-muted mb-0">Ajustes y parámetros del sistema SILAR</p>
                </div>

                <div class="col-12">
                    <div class="card">
                        <div class="card-header">
                            <h6 class="mb-0">Configuración General</h6>
                        </div>
                        <div class="card-body">
                            <div class="text-center py-5">
                                <i class="bi bi-gear text-muted" style="font-size: 4rem;"></i>
                                <h5 class="mt-3">Configuración</h5>
                                <p class="text-muted">Pantalla en desarrollo</p>
                            </div>
                            
                            <div class="row g-3 mt-4">
                                <div class="col-md-6">
                                    <button class="btn btn-primary btn-touch w-100" id="save-config-btn">
                                        <i class="bi bi-save"></i><br>
                                        Guardar Configuración
                                    </button>
                                </div>
                                <div class="col-md-6">
                                    <button class="btn btn-outline-secondary btn-touch w-100" id="reset-config-btn">
                                        <i class="bi bi-arrow-clockwise"></i><br>
                                        Restablecer
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

// Register the screen globally
window.ConfigurationScreen = ConfigurationScreen;
