/**
 * Process Screen - Control de procesos del sistema SILAR
 * Equivale a las pantallas 5 del diseño original
 */

class ProcessScreen {
    constructor(app) {
        this.app = app;
        this.currentProcess = null;
        this.timer = null;
        this.init();
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
        // Start process button
        document.getElementById('start-process-btn')?.addEventListener('click', () => {
            this.startProcess();
        });

        // Pause process button
        document.getElementById('pause-process-btn')?.addEventListener('click', () => {
            this.pauseProcess();
        });

        // Stop process button
        document.getElementById('stop-process-btn')?.addEventListener('click', () => {
            this.stopProcess();
        });
    }

    async startProcess() {
        try {
            const result = await this.app.apiCall('/process/start', {
                method: 'POST',
                body: JSON.stringify({
                    recipeId: this.selectedRecipeId
                })
            });

            this.app.showSuccess('Proceso iniciado correctamente');
            this.updateProcessStatus('running');
            this.showTimer();
            this.startTimer();
            
        } catch (error) {
            this.app.showError('Error iniciando el proceso');
        }
    }

    async pauseProcess() {
        try {
            await this.app.apiCall('/process/pause', {
                method: 'POST'
            });
            
            this.app.showSuccess('Proceso pausado');
            this.updateProcessStatus('paused');
            
            // Pausar el timer pero mantenerlo visible
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
            
        } catch (error) {
            this.app.showError('Error pausando el proceso');
        }
    }

    async resumeProcess() {
        try {
            await this.app.apiCall('/process/resume', {
                method: 'POST'
            });
            
            this.app.showSuccess('Proceso reanudado');
            this.updateProcessStatus('running');
            this.startTimer();
            
        } catch (error) {
            this.app.showError('Error reanudando el proceso');
        }
    }

    async stopProcess() {
        if (confirm('¿Está seguro que desea detener el proceso?')) {
            try {
                await this.app.apiCall('/process/stop', {
                    method: 'POST'
                });
                
                this.app.showSuccess('Proceso detenido');
                this.updateProcessStatus('stopped');
                this.hideTimer();
                this.stopTimer();
                
            } catch (error) {
                this.app.showError('Error deteniendo el proceso');
            }
        }
    }

    updateProcessStatus(status) {
        // Update UI based on process status
        const statusElement = document.getElementById('process-status');
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');
        
        if (statusElement) {
            statusElement.textContent = status;
            statusElement.className = `badge ${this.getStatusBadgeClass(status)}`;
        }
        
        if (statusDot) {
            statusDot.className = `status-dot ${status}`;
        }
        
        if (statusText) {
            statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        }
        
        // Update button states based on status
        this.updateButtonStates(status);
    }
    
    updateButtonStates(status) {
        const startBtn = document.getElementById('start-process-btn');
        const pauseBtn = document.getElementById('pause-process-btn');
        const stopBtn = document.getElementById('stop-process-btn');
        
        if (startBtn) startBtn.disabled = status === 'running';
        if (pauseBtn) pauseBtn.disabled = status === 'stopped' || status === 'paused';
        if (stopBtn) stopBtn.disabled = status === 'stopped';
        
        // Add visual feedback for disabled state
        [startBtn, pauseBtn, stopBtn].forEach(btn => {
            if (btn && btn.disabled) {
                btn.style.opacity = '0.6';
                btn.style.cursor = 'not-allowed';
            } else if (btn) {
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
        });
    }

    getStatusBadgeClass(status) {
        const classes = {
            'running': 'bg-success',
            'paused': 'bg-warning',
            'stopped': 'bg-secondary',
            'error': 'bg-danger'
        };
        return classes[status] || 'bg-secondary';
    }

    showTimer() {
        const timerElement = document.getElementById('process-timer');
        if (timerElement) {
            // Configurar estilos para el cronómetro centrado
            timerElement.style.display = 'flex';
            timerElement.style.justifyContent = 'center';
            timerElement.style.alignItems = 'center';
            timerElement.style.position = 'fixed';
            timerElement.style.top = '50%';
            timerElement.style.left = '50%';
            timerElement.style.transform = 'translate(-50%, -50%)';
            timerElement.style.zIndex = '1000';
            timerElement.style.background = 'rgba(0, 0, 0, 0.9)';
            timerElement.style.color = 'white';
            timerElement.style.padding = '2rem 3rem';
            timerElement.style.borderRadius = '15px';
            timerElement.style.fontSize = '2rem';
            timerElement.style.fontWeight = 'bold';
            timerElement.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.5)';
            timerElement.style.transition = 'all 0.3s ease';
            
            // Agregar clase para animaciones
            timerElement.classList.add('timer-active');
        }
    }

    hideTimer() {
        const timerElement = document.getElementById('process-timer');
        if (timerElement) {
            timerElement.classList.remove('timer-active');
            timerElement.style.display = 'none';
        }
    }

    startTimer() {
        this.startTime = Date.now();
        this.timer = setInterval(() => {
            const elapsed = Date.now() - this.startTime;
            const hours = Math.floor(elapsed / 3600000);
            const minutes = Math.floor((elapsed % 3600000) / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            
            const timerDisplay = document.getElementById('timer-display');
            if (timerDisplay) {
                timerDisplay.textContent = 
                    `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        const timerDisplay = document.getElementById('timer-display');
        if (timerDisplay) {
            timerDisplay.textContent = '00:00:00';
        }
    }

    static getTemplate() {
        return `
            <div class="row">
                <div class="col-12 mb-4">
                    <h3 class="mb-1">
                        <i class="bi bi-play-circle me-2 text-primary"></i>
                        Control de Procesos
                    </h3>
                    <p class="text-muted mb-0">Ejecutar y monitorear procesos SILAR</p>
                </div>

                <div class="col-12">
                    <div class="card">
                        <div class="card-header">
                            <h6 class="mb-0">Estado del Proceso</h6>
                        </div>
                        <div class="card-body">
                            <div class="text-center py-5">
                                <i class="bi bi-gear text-muted" style="font-size: 4rem;"></i>
                                <h5 class="mt-3">Control de Procesos</h5>
                                <p class="text-muted">Pantalla en desarrollo</p>
                                <span class="badge bg-secondary" id="process-status">Detenido</span>
                            </div>
                            
                            <div class="process-controls mt-4">
                                <div class="row g-4 justify-content-center">
                                    <div class="col-lg-3 col-md-4 col-sm-6">
                                        <button class="btn btn-process btn-start w-100" id="start-process-btn" onclick="this.startProcess()">
                                            <div class="btn-icon-wrapper">
                                                <i class="bi bi-play-fill"></i>
                                            </div>
                                            <div class="btn-text">
                                                <span class="btn-title">Iniciar</span>
                                                <span class="btn-subtitle">Proceso</span>
                                            </div>
                                            <div class="btn-glow"></div>
                                        </button>
                                    </div>
                                    
                                    <div class="col-lg-3 col-md-4 col-sm-6">
                                        <button class="btn btn-process btn-pause w-100" id="pause-process-btn" onclick="this.pauseProcess()">
                                            <div class="btn-icon-wrapper">
                                                <i class="bi bi-pause-fill"></i>
                                            </div>
                                            <div class="btn-text">
                                                <span class="btn-title">Pausar</span>
                                                <span class="btn-subtitle">Proceso</span>
                                            </div>
                                            <div class="btn-glow"></div>
                                        </button>
                                    </div>
                                    
                                    <div class="col-lg-3 col-md-4 col-sm-6">
                                        <button class="btn btn-process btn-stop w-100" id="stop-process-btn" onclick="this.stopProcess()">
                                            <div class="btn-icon-wrapper">
                                                <i class="bi bi-stop-fill"></i>
                                            </div>
                                            <div class="btn-text">
                                                <span class="btn-title">Detener</span>
                                                <span class="btn-subtitle">Proceso</span>
                                            </div>
                                            <div class="btn-glow"></div>
                                        </button>
                                    </div>
                                </div>
                                
                                <div class="process-status-display mt-4">
                                    <div class="status-indicator">
                                        <div class="status-dot" id="status-dot"></div>
                                        <span class="status-text" id="status-text">Detenido</span>
                                    </div>
                                    <div class="process-timer" id="process-timer" style="display: none;">
                                        <i class="bi bi-clock me-2"></i>
                                        <span id="timer-display">00:00:00</span>
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
window.ProcessScreen = ProcessScreen;
