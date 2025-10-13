/**
 * Manual Screen - Control manual del sistema SILAR
 * Equivale a las pantallas 8 del diseño original
 */

class ManualScreen {
    constructor(app) {
        this.app = app;
        this.arduinoState = null;
        this.init();
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
            this.moveY(1000);
        });
        document.getElementById('btn-y-backward')?.addEventListener('click', () => {
            this.moveY(-1000);
        });

        // Movimientos Eje Z
        document.getElementById('btn-z-up')?.addEventListener('click', () => {
            this.moveZ(500);
        });
        document.getElementById('btn-z-down')?.addEventListener('click', () => {
            this.moveZ(-500);
        });

        // Paro de Emergencia
        document.getElementById('btn-emergency-stop')?.addEventListener('click', () => {
            this.emergencyStop();
        });
    }

    setupArduinoListeners() {
        if (!this.app.socket) return;

        // Escuchar estado del Arduino
        this.app.socket.on('arduino-state', (state) => {
            this.arduinoState = state;
            this.updateStateDisplay();
        });

        // Escuchar datos del Arduino
        this.app.socket.on('arduino-data', (data) => {
            this.handleArduinoData(data);
        });

        // Escuchar errores
        this.app.socket.on('arduino-error', (error) => {
            this.app.showError(`Error Arduino: ${error.error || error.message}`);
        });
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
            <div class="row">
                <div class="col-12 mb-4">
                    <h3 class="mb-1">
                        <i class="bi bi-joystick me-2 text-primary"></i>
                        Control Manual
                    </h3>
                    <p class="text-muted mb-0">Operación manual de componentes del sistema SILAR</p>
                </div>

                <!-- Estado del Arduino -->
                <div class="col-12 mb-3">
                    <div class="card">
                        <div class="card-body">
                            <div class="row align-items-center">
                                <div class="col-md-4">
                                    <small class="text-muted">Estado Conexión</small><br>
                                    <span class="badge bg-secondary" id="arduino-connection-status">Verificando...</span>
                                </div>
                                <div class="col-md-4">
                                    <small class="text-muted">Modo Actual</small><br>
                                    <strong id="arduino-mode-status">-</strong>
                                </div>
                                <div class="col-md-4">
                                    <small class="text-muted">Posiciones</small><br>
                                    Y: <span id="axis-y-position">0</span> | Z: <span id="axis-z-position">0</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Controles de Modo -->
                <div class="col-md-6 mb-3">
                    <div class="card">
                        <div class="card-header">
                            <h6 class="mb-0"><i class="bi bi-gear me-2"></i>Modo de Operación</h6>
                        </div>
                        <div class="card-body">
                            <div class="row g-3">
                                <div class="col-6">
                                    <button class="btn btn-outline-primary w-100 py-3" id="btn-mode-manual">
                                        <i class="bi bi-hand-index d-block fs-2 mb-2"></i>
                                        Modo Manual
                                    </button>
                                </div>
                                <div class="col-6">
                                    <button class="btn btn-outline-success w-100 py-3" id="btn-mode-automatic">
                                        <i class="bi bi-cpu d-block fs-2 mb-2"></i>
                                        Modo Automático
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- HOME -->
                <div class="col-md-6 mb-3">
                    <div class="card">
                        <div class="card-header">
                            <h6 class="mb-0"><i class="bi bi-house me-2"></i>Posición Inicial</h6>
                        </div>
                        <div class="card-body">
                            <button class="btn btn-warning w-100 py-3" id="btn-home">
                                <i class="bi bi-house-door d-block fs-2 mb-2"></i>
                                Ejecutar HOME
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Control Eje Y -->
                <div class="col-md-6 mb-3">
                    <div class="card">
                        <div class="card-header">
                            <h6 class="mb-0"><i class="bi bi-arrows-vertical me-2"></i>Control Eje Y</h6>
                        </div>
                        <div class="card-body">
                            <div class="row g-3">
                                <div class="col-6">
                                    <button class="btn btn-primary btn-lg w-100" id="btn-y-forward">
                                        <i class="bi bi-arrow-up-circle fs-3 d-block mb-2"></i>
                                        Y+ (Adelante)
                                    </button>
                                </div>
                                <div class="col-6">
                                    <button class="btn btn-primary btn-lg w-100" id="btn-y-backward">
                                        <i class="bi bi-arrow-down-circle fs-3 d-block mb-2"></i>
                                        Y- (Atrás)
                                    </button>
                                </div>
                            </div>
                            <div class="mt-3 text-center">
                                <small class="text-muted">Posición Actual: <strong id="axis-y-position-display">0</strong> pasos</small>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Control Eje Z -->
                <div class="col-md-6 mb-3">
                    <div class="card">
                        <div class="card-header">
                            <h6 class="mb-0"><i class="bi bi-arrows-vertical me-2"></i>Control Eje Z</h6>
                        </div>
                        <div class="card-body">
                            <div class="row g-3">
                                <div class="col-6">
                                    <button class="btn btn-success btn-lg w-100" id="btn-z-up">
                                        <i class="bi bi-arrow-up-circle fs-3 d-block mb-2"></i>
                                        Z+ (Arriba)
                                    </button>
                                </div>
                                <div class="col-6">
                                    <button class="btn btn-success btn-lg w-100" id="btn-z-down">
                                        <i class="bi bi-arrow-down-circle fs-3 d-block mb-2"></i>
                                        Z- (Abajo)
                                    </button>
                                </div>
                            </div>
                            <div class="mt-3 text-center">
                                <small class="text-muted">Posición Actual: <strong id="axis-z-position-display">0</strong> pasos</small>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Paro de Emergencia -->
                <div class="col-12">
                    <div class="card border-danger">
                        <div class="card-header bg-danger text-white">
                            <h6 class="mb-0"><i class="bi bi-exclamation-triangle me-2"></i>Emergencia</h6>
                        </div>
                        <div class="card-body text-center">
                            <button class="btn btn-danger btn-lg px-5 py-3" id="btn-emergency-stop">
                                <i class="bi bi-stop-circle fs-2 d-block mb-2"></i>
                                PARO DE EMERGENCIA
                            </button>
                            <small class="d-block mt-2 text-muted">
                                Detiene todos los movimientos inmediatamente
                            </small>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

// Register the screen globally
window.ManualScreen = ManualScreen;
