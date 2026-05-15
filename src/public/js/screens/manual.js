/**
 * Manual Screen - Control manual del sistema SILAR
 * Equivale a las pantallas 8 del diseño original
 */

class ManualScreen {
    constructor(app) {
        this.app = app;
        this.arduinoState = null;
        
        // Binds
        this.onArduinoState = this.onArduinoState.bind(this);
        this.onArduinoData = this.onArduinoData.bind(this);
        this.onArduinoError = this.onArduinoError.bind(this);
        
        this.init();
    }

    destroy() {
        console.log('ManualScreen destroyed');
        if (this.app.socket) {
            this.app.socket.off('arduino-state', this.onArduinoState);
            this.app.socket.off('arduino-data', this.onArduinoData);
            this.app.socket.off('arduino-error', this.onArduinoError);
        }
    }

    init() {
        this.bindEvents();
        this.setupArduinoListeners();
    }

    bindEvents() {
        // Manual control buttons se vincularán después de renderizar
        setTimeout(() => {
            this.bindControlButtons();
        }, 100);
    }

    bindControlButtons() {
        // Modo Manual
        document.getElementById('btn-mode-manual')?.addEventListener('click', () => {
            this.setModeManual();
        });

        // Modo Automático
        document.getElementById('btn-mode-automatic')?.addEventListener('click', () => {
            this.setModeAutomatic();
        });

        // HOME
        document.getElementById('btn-home')?.addEventListener('click', () => {
            this.executeHome();
        });

        // Movimientos Eje Y
        document.getElementById('btn-y-forward')?.addEventListener('click', () => {
            this.moveY(10000);
        });
        document.getElementById('btn-y-backward')?.addEventListener('click', () => {
            this.moveY(-10000);
        });

        // Movimientos Eje Z
        document.getElementById('btn-z-up')?.addEventListener('click', () => {
            this.moveZ(10000);
        });
        document.getElementById('btn-z-down')?.addEventListener('click', () => {
            this.moveZ(-10000);
        });

        // Paro de Emergencia
        document.getElementById('btn-emergency-stop')?.addEventListener('click', () => {
            this.emergencyStop();
        });
    }

    setupArduinoListeners() {
        if (!this.app.socket) return;

        // Escuchar estado del Arduino
        this.app.socket.on('arduino-state', this.onArduinoState);

        // Escuchar datos del Arduino
        this.app.socket.on('arduino-data', this.onArduinoData);

        // Escuchar errores
        this.app.socket.on('arduino-error', this.onArduinoError);
    }

    onArduinoState(state) {
        this.arduinoState = state;
        this.updateStateDisplay();
    }

    onArduinoData(data) {
        this.handleArduinoData(data);
    }

    onArduinoError(error) {
        this.app.showError(`Error Arduino: ${error.error || error.message}`);
    }

    handleArduinoData(data) {
        console.log('Arduino data:', data);
        
        if (data.type === 'mode') {
            this.app.showSuccess(`Modo cambiado a: ${data.mode}`);
        } else if (data.type === 'home') {
            if (data.complete) {
                this.app.showSuccess(`HOME ${data.axis} completado`);
            } else {
                this.app.showInfo(`Buscando HOME ${data.axis}...`);
            }
        } else if (data.type === 'position') {
            this.updateAxisPosition(data.axis, data.position);
        } else if (data.type === 'limit') {
            this.app.showWarning(`Límite alcanzado en ${data.axis} ${data.limit}`);
        } else if (data.type === 'emergency') {
            this.app.showError('¡PARO DE EMERGENCIA ACTIVADO!');
        }
    }

    updateStateDisplay() {
        if (!this.arduinoState) return;

        // Actualizar indicador de conexión
        const connectionStatus = document.getElementById('arduino-connection-status');
        if (connectionStatus) {
            connectionStatus.textContent = this.arduinoState.isConnected ? 'Conectado' : 'Desconectado';
            connectionStatus.className = `badge ${this.arduinoState.isConnected ? 'bg-success' : 'bg-danger'}`;
        }

        // Actualizar modo
        const modeStatus = document.getElementById('arduino-mode-status');
        if (modeStatus) {
            modeStatus.textContent = this.arduinoState.mode || 'DESCONOCIDO';
        }

        // Actualizar posiciones
        const posY = document.getElementById('axis-y-position');
        if (posY) {
            posY.textContent = this.arduinoState.axisY?.position || 0;
        }

        const posZ = document.getElementById('axis-z-position');
        if (posZ) {
            posZ.textContent = this.arduinoState.axisZ?.position || 0;
        }
    }

    updateAxisPosition(axis, position) {
        const element = document.getElementById(`axis-${axis.toLowerCase()}-position`);
        if (element) {
            element.textContent = position;
        }
    }

    setModeManual() {
        this.app.socket.emit('arduino-command', {
            command: 'MODE_MANUAL'
        });
        this.app.showInfo('Configurando modo MANUAL...');
    }

    setModeAutomatic() {
        this.app.socket.emit('arduino-command', {
            command: 'MODE_AUTOMATIC'
        });
        this.app.showInfo('Configurando modo AUTOMÁTICO...');
    }

    executeHome() {
        if (confirm('¿Ejecutar secuencia HOME? Los ejes se moverán a posición inicial.')) {
            this.app.socket.emit('arduino-command', {
                command: 'HOME'
            });
            this.app.showInfo('Ejecutando HOME...');
        }
    }

    moveY(steps) {
        this.app.socket.emit('arduino-command', {
            command: 'MOVE_Y',
            params: { steps }
        });
        this.app.showInfo(`Moviendo eje Y: ${steps} pasos`);
    }

    moveZ(steps) {
        this.app.socket.emit('arduino-command', {
            command: 'MOVE_Z',
            params: { steps }
        });
        this.app.showInfo(`Moviendo eje Z: ${steps} pasos`);
    }

    emergencyStop() {
        this.app.socket.emit('arduino-command', {
            command: 'STOP'
        });
        this.app.showWarning('Enviando PARO DE EMERGENCIA...');
    }

    static getTemplate() {
        return `
            <div class="row g-3">
                <div class="col-12 mb-1">
                    <h4 class="mb-1 fw-bold">
                        <i class="bi bi-joystick me-2 text-primary"></i>
                        Control Manual
                    </h4>
                </div>


                <!-- Controles de Modo -->
                <div class="col-md-6">
                    <div class="card shadow-sm border-0">
                        <div class="card-header bg-primary text-white py-2">
                            <h6 class="mb-0 small fw-bold"><i class="bi bi-gear me-2"></i>Modo de Operación</h6>
                        </div>
                        <div class="card-body p-3">
                            <div class="row g-2">
                                <div class="col-6">
                                    <button class="btn btn-outline-primary w-100 py-3" id="btn-mode-manual">
                                        <i class="bi bi-hand-index d-block fs-3 mb-2"></i>
                                        <span class="fw-bold">Modo Manual</span>
                                    </button>
                                </div>
                                <div class="col-6">
                                    <button class="btn btn-outline-success w-100 py-3" id="btn-mode-automatic">
                                        <i class="bi bi-cpu d-block fs-3 mb-2"></i>
                                        <span class="fw-bold">Modo Automático</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- HOME -->
                <div class="col-md-6">
                    <div class="card shadow-sm border-0">
                        <div class="card-header bg-primary text-white py-2">
                            <h6 class="mb-0 small fw-bold"><i class="bi bi-house me-2"></i>Posición Inicial</h6>
                        </div>
                        <div class="card-body p-3">
                            <button class="btn btn-warning w-100 py-3" id="btn-home">
                                <i class="bi bi-house-door d-block fs-3 mb-2"></i>
                                <span class="fw-bold">Ejecutar HOME</span>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Control Eje Y -->
                <div class="col-md-6">
                    <div class="card shadow-sm border-0">
                        <div class="card-header bg-primary text-white py-2">
                            <h6 class="mb-0 small fw-bold"><i class="bi bi-arrows-vertical me-2"></i>Control Eje Y</h6>
                        </div>
                        <div class="card-body p-3">
                            <div class="row g-2">
                                <div class="col-6">
                                    <button class="btn btn-primary w-100 py-3" id="btn-y-forward">
                                        <i class="bi bi-arrow-up-circle fs-3 d-block mb-2"></i>
                                        <span class="fw-bold">Y+ (Adelante)</span>
                                    </button>
                                </div>
                                <div class="col-6">
                                    <button class="btn btn-primary w-100 py-3" id="btn-y-backward">
                                        <i class="bi bi-arrow-down-circle fs-3 d-block mb-2"></i>
                                        <span class="fw-bold">Y- (Atrás)</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Control Eje Z -->
                <div class="col-md-6">
                    <div class="card shadow-sm border-0">
                        <div class="card-header bg-primary text-white py-2">
                            <h6 class="mb-0 small fw-bold"><i class="bi bi-arrows-vertical me-2"></i>Control Eje Z</h6>
                        </div>
                        <div class="card-body p-3">
                            <div class="row g-2">
                                <div class="col-6">
                                    <button class="btn btn-success w-100 py-3" id="btn-z-up">
                                        <i class="bi bi-arrow-up-circle fs-3 d-block mb-2"></i>
                                        <span class="fw-bold">Z+ (Arriba)</span>
                                    </button>
                                </div>
                                <div class="col-6">
                                    <button class="btn btn-success w-100 py-3" id="btn-z-down">
                                        <i class="bi bi-arrow-down-circle fs-3 d-block mb-2"></i>
                                        <span class="fw-bold">Z- (Abajo)</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Paro de Emergencia -->
                <div class="col-12">
                    <div class="card border-danger shadow-sm">
                        <div class="card-header bg-danger text-white py-2">
                            <h6 class="mb-0 small fw-bold text-center"><i class="bi bi-exclamation-triangle me-2"></i>Emergencia</h6>
                        </div>
                        <div class="card-body p-3 text-center">
                            <button class="btn btn-danger w-100 py-3" id="btn-emergency-stop">
                                <i class="bi bi-stop-circle fs-3 me-2"></i>
                                <span class="fw-bold fs-5">PARO DE EMERGENCIA</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

// Register the screen globally
window.ManualScreen = ManualScreen;
