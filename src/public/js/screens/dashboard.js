/**
 * Dashboard Screen - Pantalla principal del sistema SILAR
 * Equivale a la pantalla 1 del diseño original
 */

class DashboardScreen {
    constructor(app) {
        this.app = app;
        this.userRole = app.userSession?.role || 'usuario';
        this.statsInterval = null;
        this.init();
    }

    init() {
        this.renderDashboard();
    }





    renderDashboard() {
        const container = document.getElementById('screen-container');
        if (container) {
            container.innerHTML = DashboardScreen.getTemplate();
        }
    }







    static getTemplate() {
        return `
            <div class="dashboard-container">
                <!-- Welcome Header -->
                                <div class="welcome-header mb-4">
                    <div class="row align-items-center">
                        <div class="col-12">
                            <h1 class="welcome-title text-center">
                                <i class="bi bi-layers me-3"></i>
                                Bienvenido al Sistema SILAR
                            </h1>
                            <p class="welcome-subtitle text-muted text-center">
                                Control y monitoreo para síntesis de películas delgadas por capas iónicas sucesivas
                            </p>
                        </div>
                    </div>
                </div>

                <!-- Navigation Cards Row -->
                <div class="row g-4">
                    <div class="col-xl-3 col-lg-4 col-md-6">
                        <div class="card border-0 shadow-sm h-100 navigation-card" onclick="window.silarApp.navigateToScreen('recipes')">
                            <div class="card-body text-center p-4">
                                <div class="navigation-icon bg-primary text-white mb-3">
                                    <i class="bi bi-journal-text"></i>
                                </div>
                                <h5 class="card-title text-primary mb-2">Recetas</h5>
                                <p class="card-text text-muted">Gestiona y crea recetas para procesos SILAR</p>
                                <div class="navigation-arrow">
                                    <i class="bi bi-arrow-right-circle text-primary"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="col-xl-3 col-lg-4 col-md-6">
                        <div class="card border-0 shadow-sm h-100 navigation-card" onclick="window.silarApp.navigateToScreen('process')">
                            <div class="card-body text-center p-4">
                                <div class="navigation-icon bg-success text-white mb-3">
                                    <i class="bi bi-play-circle"></i>
                                </div>
                                <h5 class="card-title text-success mb-2">Proceso</h5>
                                <p class="card-text text-muted">Ejecuta y controla procesos SILAR</p>
                                <div class="navigation-arrow">
                                    <i class="bi bi-arrow-right-circle text-success"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="col-xl-3 col-lg-4 col-md-6">
                        <div class="card border-0 shadow-sm h-100 navigation-card" onclick="window.silarApp.navigateToScreen('monitoring')">
                            <div class="card-body text-center p-4">
                                <div class="navigation-icon bg-info text-white mb-3">
                                    <i class="bi bi-graph-up"></i>
                                </div>
                                <h5 class="card-title text-info mb-2">Monitoreo</h5>
                                <p class="card-text text-muted">Monitorea variables y estado del sistema</p>
                                <div class="navigation-arrow">
                                    <i class="bi bi-arrow-right-circle text-info"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="col-xl-3 col-lg-4 col-md-6">
                        <div class="card border-0 shadow-sm h-100 navigation-card" onclick="window.silarApp.navigateToScreen('configuration')">
                            <div class="card-body text-center p-4">
                                <div class="navigation-icon bg-warning text-white mb-3">
                                    <i class="bi bi-gear"></i>
                                </div>
                                <h5 class="card-title text-warning mb-2">Configuración</h5>
                                <p class="card-text text-muted">Configura parámetros del sistema</p>
                                <div class="navigation-arrow">
                                    <i class="bi bi-arrow-right-circle text-warning"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="col-xl-3 col-lg-4 col-md-6">
                        <div class="card border-0 shadow-sm h-100 navigation-card" onclick="window.silarApp.navigateToScreen('manual')">
                            <div class="card-body text-center p-4">
                                <div class="navigation-icon bg-danger text-white mb-3">
                                    <i class="bi bi-hand-index"></i>
                                </div>
                                <h5 class="card-title text-danger mb-2">Control Manual</h5>
                                <p class="card-text text-muted">Control manual del sistema SILAR</p>
                                <div class="navigation-arrow">
                                    <i class="bi bi-arrow-right-circle text-danger"></i>
                                </div>
                            </div>
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
window.DashboardScreen = DashboardScreen;
