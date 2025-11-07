/**
 * Process Screen - Control de procesos del sistema SILAR
 * Equivale a las pantallas 5 del diseño original
 */

class ProcessScreen {
    constructor(app) {
        this.app = app;
        this.currentProcess = null;
        this.timer = null;
        this.currentStatus = 'stopped'; // Almacenar el estado actual
        this.startTime = null; // Inicializar startTime
        this.isTimerRunning = false; // Flag para evitar múltiples timers
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadProcessStatus();
    }

    async loadProcessStatus() {
        try {
            const result = await this.app.apiCall('/process/status', {
                method: 'GET'
            });

            if (result && result.success) {
                const status = result.status || 'stopped';
                
                // CRÍTICO: Si ya tenemos un timer ejecutándose localmente, NO iniciar otro
                // sin importar lo que diga el servidor
                if (this.isTimerRunning) {
                    console.log('Timer ya ejecutándose localmente, ignorando estado del servidor para evitar duplicados');
                    return;
                }
                
                // CRÍTICO: Si ya tenemos un proceso ejecutándose localmente y el servidor dice que está detenido,
                // NO sobrescribir el estado local porque puede ser que acabamos de iniciar un proceso
                // Solo actualizar si realmente hay una diferencia significativa
                if (status === 'running' && result.process) {
                    // Solo actualizar si no tenemos un proceso ejecutándose localmente
                    // o si el proceso del servidor es diferente
                    if (this.currentStatus !== 'running') {
                        this.updateProcessStatus(status);
                        this.showTimer();
                        // Si el proceso ya estaba ejecutándose en el servidor, usar su startTime
                        if (result.process.startTime) {
                            const startTime = new Date(result.process.startTime);
                            this.startTime = startTime.getTime();
                            // Solo iniciar timer si no hay uno ejecutándose
                            if (!this.isTimerRunning) {
                                this.startTimer();
                            }
                        }
                    } else {
                        // Si ya tenemos un proceso ejecutándose localmente, NO sobrescribir el startTime
                        // porque puede ser más reciente que el del servidor
                        console.log('Proceso ya ejecutándose localmente, manteniendo estado local');
                    }
                } else {
                    // Si el servidor dice que no hay proceso ejecutándose
                    // Solo actualizar si realmente no tenemos uno ejecutándose localmente
                    if (this.currentStatus !== 'running' && this.currentStatus !== 'paused') {
                        this.updateProcessStatus(status);
                        this.hideTimer();
                        // Asegurarse de que el timer esté completamente detenido y reseteado
                        this.stopTimer();
                        // Asegurarse de que startTime esté reseteado cuando no hay proceso
                        this.startTime = null;
                    }
                }
            }
        } catch (error) {
            console.error('Error cargando estado del proceso:', error);
            // Si hay error, solo actualizar el estado si no tenemos uno local
            if (this.currentStatus === 'stopped') {
                this.updateProcessStatus('stopped');
            }
        }
    }

    bindEvents() {
        // Start process button
        document.getElementById('start-process-btn')?.addEventListener('click', () => {
            this.startProcess();
        });

        // Pause/Resume process button (toggle)
        document.getElementById('pause-process-btn')?.addEventListener('click', () => {
            if (this.currentStatus === 'paused') {
                this.resumeProcess();
            } else {
                this.pauseProcess();
            }
        });

        // Stop process button
        document.getElementById('stop-process-btn')?.addEventListener('click', () => {
            this.stopProcess();
        });
    }

    async startProcess() {
        try {
            // Verificar si hay una receta seleccionada
            if (!this.selectedRecipeId) {
                this.app.showError('Debe seleccionar una receta antes de iniciar el proceso');
                return;
            }

            // CRÍTICO: Limpiar COMPLETAMENTE cualquier timer existente ANTES de iniciar
            console.log('Iniciando proceso - Limpiando timers anteriores...');
            this.forceStopTimer();
            this.hideTimer();
            // Forzar reset completo del startTime
            this.startTime = null;
            
            // Pequeño delay para asegurar que todo esté limpio
            await new Promise(resolve => setTimeout(resolve, 50));

            const result = await this.app.apiCall('/process/start', {
                method: 'POST',
                body: JSON.stringify({
                    recipeId: this.selectedRecipeId
                })
            });

            if (result && result.success) {
                this.app.showSuccess(result.message || 'Proceso iniciado correctamente');
                this.updateProcessStatus('running');
                
                // CRÍTICO: Establecer nuevo tiempo de inicio DESPUÉS de que el servidor confirme
                // Usar el tiempo actual del cliente para evitar problemas de sincronización
                // NO usar el startTime del servidor para procesos nuevos iniciados desde aquí
                this.startTime = Date.now();
                
                console.log('Nuevo proceso iniciado con startTime:', new Date(this.startTime).toISOString());
                
                // Mostrar y iniciar el timer inmediatamente
                this.showTimer();
                this.startTimer();
                
                // NO recargar el estado del servidor aquí porque acabamos de iniciar el proceso
                // y ya tenemos el estado correcto localmente
            }
            
        } catch (error) {
            // Manejar error específico cuando ya hay un proceso ejecutándose
            if (error.status === 409) {
                const errorData = error.responseData ? JSON.parse(error.responseData) : null;
                const message = errorData?.message || 'Ya hay un proceso ejecutándose. Debe detenerlo antes de iniciar uno nuevo.';
                this.app.showError(message);
                // NO recargar el estado aquí porque puede interferir si el usuario detiene e inicia inmediatamente
                // Solo sincronizar si realmente es necesario
            } else {
                const errorMessage = error.message || 'Error iniciando el proceso';
                this.app.showError(errorMessage);
            }
        }
    }

    async pauseProcess() {
        try {
            const result = await this.app.apiCall('/process/pause', {
                method: 'POST'
            });
            
            if (result && result.success) {
                this.app.showSuccess(result.message || 'Proceso pausado');
                this.updateProcessStatus('paused');
                
                // Pausar el timer pero mantenerlo visible
                this.forceStopTimer();
            }
            
        } catch (error) {
            const errorMessage = error.message || 'Error pausando el proceso';
            this.app.showError(errorMessage);
            // Recargar el estado para sincronizar
            this.loadProcessStatus();
        }
    }

    async resumeProcess() {
        try {
            const result = await this.app.apiCall('/process/resume', {
                method: 'POST'
            });
            
            if (result && result.success) {
                this.app.showSuccess(result.message || 'Proceso reanudado');
                this.updateProcessStatus('running');
                // Si el timer no está ejecutándose, iniciarlo
                // Si ya está ejecutándose, no hacer nada (el tiempo ya está correcto)
                if (!this.isTimerRunning) {
                    this.startTimer();
                }
            }
            
        } catch (error) {
            const errorMessage = error.message || 'Error reanudando el proceso';
            this.app.showError(errorMessage);
            // Recargar el estado para sincronizar
            this.loadProcessStatus();
        }
    }

    async stopProcess() {
        if (confirm('¿Está seguro que desea detener el proceso?')) {
            try {
                const result = await this.app.apiCall('/process/stop', {
                    method: 'POST'
                });
                
                if (result && result.success) {
                    this.app.showSuccess(result.message || 'Proceso detenido');
                    this.updateProcessStatus('stopped');
                    
                    // CRÍTICO: Detener y ocultar el timer COMPLETAMENTE
                    console.log('Deteniendo proceso - Limpiando timers...');
                    this.forceStopTimer();
                    this.hideTimer();
                    
                    // Asegurarse de que startTime esté completamente reseteado
                    this.startTime = null;
                    
                    // NO recargar el estado del servidor aquí porque puede interferir
                    // si el usuario inicia un nuevo proceso inmediatamente después
                }
                
            } catch (error) {
                const errorMessage = error.message || 'Error deteniendo el proceso';
                this.app.showError(errorMessage);
                // Solo recargar el estado si hay un error para sincronizar
                this.loadProcessStatus();
            }
        }
    }

    updateProcessStatus(status) {
        // Actualizar el estado actual
        this.currentStatus = status;
        
        // Update UI based on process status
        const statusElement = document.getElementById('process-status');
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');
        
        // Mapear estados a texto en español
        const statusTextMap = {
            'running': 'Ejecutándose',
            'paused': 'Pausado',
            'stopped': 'Detenido',
            'completed': 'Completado',
            'cancelled': 'Cancelado',
            'failed': 'Fallido',
            'error': 'Error'
        };
        
        const displayText = statusTextMap[status] || status.charAt(0).toUpperCase() + status.slice(1);
        
        if (statusElement) {
            statusElement.textContent = displayText;
            statusElement.className = `badge ${this.getStatusBadgeClass(status)}`;
        }
        
        if (statusDot) {
            statusDot.className = `status-dot ${status}`;
        }
        
        if (statusText) {
            statusText.textContent = displayText;
        }
        
        // Update button states based on status
        this.updateButtonStates(status);
        
        // Emitir evento para que otras pantallas se actualicen
        document.dispatchEvent(new CustomEvent('process-status-changed', {
            detail: { status: status }
        }));
    }
    
    updateButtonStates(status) {
        const startBtn = document.getElementById('start-process-btn');
        const pauseBtn = document.getElementById('pause-process-btn');
        const stopBtn = document.getElementById('stop-process-btn');
        
        // Solo deshabilitar inicio si hay un proceso ejecutándose o pausado
        if (startBtn) startBtn.disabled = status === 'running' || status === 'paused';
        
        // El botón de pausa/reanudar solo está habilitado cuando hay un proceso ejecutándose o pausado
        if (pauseBtn) {
            pauseBtn.disabled = status !== 'running' && status !== 'paused';
            // Cambiar el texto del botón según el estado
            const btnText = pauseBtn.querySelector('.btn-title');
            if (btnText) {
                btnText.textContent = status === 'paused' ? 'Reanudar' : 'Pausar';
            }
        }
        
        if (stopBtn) stopBtn.disabled = status === 'stopped' || status === 'completed' || status === 'cancelled';
        
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
            'completed': 'bg-info',
            'cancelled': 'bg-secondary',
            'failed': 'bg-danger',
            'error': 'bg-danger'
        };
        return classes[status] || 'bg-secondary';
    }

    showTimer() {
        const timerElement = document.getElementById('process-timer');
        if (timerElement) {
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
        // CRÍTICO: Verificar ANTES de hacer cualquier cosa si ya hay un timer ejecutándose
        if (this.isTimerRunning) {
            console.warn('⚠️ Timer ya está ejecutándose, abortando inicio de nuevo timer');
            return;
        }
        
        // CRÍTICO: Detener TODOS los timers posibles primero
        this.forceStopTimer();
        
        // CRÍTICO: Asegurarse de que startTime esté establecido y sea válido
        // Si no hay startTime o es null/undefined, establecerlo ahora
        if (!this.startTime || typeof this.startTime !== 'number') {
            this.startTime = Date.now();
        }
        
        // Marcar que el timer está ejecutándose ANTES de crear el intervalo
        this.isTimerRunning = true;
        
        // Inicializar el display inmediatamente con el tiempo correcto
        const timerDisplay = document.getElementById('timer-display');
        if (timerDisplay) {
            const elapsed = Date.now() - this.startTime;
            const hours = Math.floor(elapsed / 3600000);
            const minutes = Math.floor((elapsed % 3600000) / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            timerDisplay.textContent = 
                `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        
        // Crear el nuevo intervalo
        this.timer = setInterval(() => {
            // Verificar que startTime sigue siendo válido en cada iteración
            if (!this.startTime || typeof this.startTime !== 'number') {
                console.warn('startTime inválido en timer, reseteando...');
                this.startTime = Date.now();
            }
            
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
        
        console.log('✅ Timer iniciado con startTime:', new Date(this.startTime).toISOString());
    }

    forceStopTimer() {
        // Detener TODOS los intervalos posibles
        if (this.timer) {
            try {
                clearInterval(this.timer);
            } catch (e) {
                console.error('Error deteniendo timer:', e);
            }
            this.timer = null;
        }
        
        // Resetear el flag
        this.isTimerRunning = false;
        
        // Resetear el display del timer
        const timerDisplay = document.getElementById('timer-display');
        if (timerDisplay) {
            timerDisplay.textContent = '00:00:00';
        }
    }

    stopTimer() {
        // Usar el método de limpieza forzada
        this.forceStopTimer();
        
        // CRÍTICO: Resetear completamente el tiempo de inicio
        this.startTime = null;
        
        console.log('Timer detenido completamente');
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
                                        <button class="btn btn-process btn-start w-100" id="start-process-btn">
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
                                        <button class="btn btn-process btn-pause w-100" id="pause-process-btn">
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
                                        <button class="btn btn-process btn-stop w-100" id="stop-process-btn">
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
