/**
 * Manual Screen - Control manual del sistema SILAR
 * Equivale a las pantallas 8 del diseño original
 */

class ManualScreen {
    constructor(app) {
        this.app = app;
        this.init();
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
        // Manual control buttons
        document.querySelectorAll('.manual-control-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const command = e.target.getAttribute('data-command');
                this.sendManualCommand(command);
            });
        });
    }

    sendManualCommand(command) {
        console.log('Manual command:', command);
        this.app.sendArduinoCommand(command);
        this.app.showSuccess(`Comando manual enviado: ${command}`);
    }

    static getTemplate() {
        return `
            <div class="row">
                <div class="col-12 mb-4">
                    <h3 class="mb-1">
                        <i class="bi bi-joystick me-2 text-primary"></i>
                        Control Manual
                    </h3>
                    <p class="text-muted mb-0">Operación manual de componentes del sistema</p>
                </div>

                <div class="col-12">
                    <div class="card">
                        <div class="card-header">
                            <h6 class="mb-0">Controles Manuales</h6>
                        </div>
                        <div class="card-body">
                            <div class="text-center py-5">
                                <i class="bi bi-joystick text-muted" style="font-size: 4rem;"></i>
                                <h5 class="mt-3">Control Manual</h5>
                                <p class="text-muted">Pantalla en desarrollo</p>
                            </div>
                            
                            <div class="row g-3 mt-4">
                                <div class="col-md-3">
                                    <button class="btn btn-primary btn-touch w-100 manual-control-btn" data-command="MOVE_X_FORWARD">
                                        <i class="bi bi-arrow-right"></i><br>
                                        Mover X+
                                    </button>
                                </div>
                                <div class="col-md-3">
                                    <button class="btn btn-primary btn-touch w-100 manual-control-btn" data-command="MOVE_X_BACKWARD">
                                        <i class="bi bi-arrow-left"></i><br>
                                        Mover X-
                                    </button>
                                </div>
                                <div class="col-md-3">
                                    <button class="btn btn-success btn-touch w-100 manual-control-btn" data-command="MOVE_Y_UP">
                                        <i class="bi bi-arrow-up"></i><br>
                                        Mover Y+
                                    </button>
                                </div>
                                <div class="col-md-3">
                                    <button class="btn btn-success btn-touch w-100 manual-control-btn" data-command="MOVE_Y_DOWN">
                                        <i class="bi bi-arrow-down"></i><br>
                                        Mover Y-
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
window.ManualScreen = ManualScreen;
