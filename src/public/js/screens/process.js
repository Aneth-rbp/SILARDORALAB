/**
 * Process Screen - Control de procesos del sistema SILAR
 * Equivale a las pantallas 5 del diseño original
 */

class ProcessScreen {
    constructor(app) {
        this.app = app;
        // Id del proceso que se está mostrando. Antes solo se guardaba el
        // estado ('running'/'paused'), así que si terminaba una corrida y
        // empezaba otra la pantalla no se enteraba: el texto del estado era el
        // mismo y todas las comprobaciones eran `currentStatus !== status`.
        this.currentProcessId = null;
        this.handleStageChanged = this.handleStageChanged.bind(this);
        this.timer = null;
        this.currentStatus = 'stopped'; // Almacenar el estado actual
        this.startTime = null; // Inicializar startTime
        this.isTimerRunning = false; // Flag para evitar múltiples timers
        // El cronómetro se congela durante la pausa, así que hay que descontar
        // lo que duró: sin esto, al reanudar el número saltaba de golpe con
        // todo el tiempo que la máquina estuvo parada.
        this.pausedAccumMs = 0;
        this.pausedSinceMs = null;
        this.init();
    }

    destroy() {
        console.log('ProcessScreen destroyed');
        this.forceStopTimer();
        this.stopStatusPolling();
        document.removeEventListener('process-stage-changed', this.handleStageChanged);
    }

    init() {
        this.bindEvents();
        this.loadProcessStatus();
        this.startStatusPolling();

        document.addEventListener('process-stage-changed', this.handleStageChanged);
        // Si ya había una corrida por etapas en marcha antes de abrir esta
        // pantalla, el evento ya pasó: se toma la etapa que guardó la app.
        this.updateStageBadge(this.app.processData?.currentStage || null);
    }

    handleStageChanged(evento) {
        this.updateStageBadge(evento.detail);
    }

    /**
     * "Etapa 2/3" junto al estado. En una receta normal no hay etapas y el
     * distintivo no se muestra.
     */
    updateStageBadge(etapa) {
        const distintivo = document.getElementById('process-stage');
        if (!distintivo) return;

        if (!etapa) {
            distintivo.classList.add('d-none');
            distintivo.textContent = '';
            return;
        }

        const ciclos = etapa.cycles ? ` · ${etapa.cycles} ciclos` : '';
        distintivo.textContent = `Etapa ${etapa.stage}/${etapa.totalStages}${ciclos}`;
        distintivo.classList.remove('d-none');
    }

    startStatusPolling() {
        this.stopStatusPolling();
        this.statusPollInterval = setInterval(() => {
            const terminalStates = ['stopped', 'completed', 'cancelled', 'failed', 'error'];
            if (!terminalStates.includes(this.currentStatus)) {
                this.loadProcessStatus();
            }
        }, 3000);
    }

    stopStatusPolling() {
        if (this.statusPollInterval) {
            clearInterval(this.statusPollInterval);
            this.statusPollInterval = null;
        }
    }

    async loadProcessStatus() {
        try {
            const result = await this.app.apiCall('/process/status', {
                method: 'GET'
            });

            if (result && result.success) {
                const status = result.status || 'stopped';
                const processId = result.process ? result.process.id : null;
                const terminalStates = ['stopped', 'completed', 'cancelled', 'failed', 'error'];

                // Calcular desfase de reloj si el servidor proporciona su hora actual
                let clockOffset = 0;
                if (result.serverTime) {
                    const serverTime = new Date(result.serverTime).getTime();
                    const clientTime = Date.now();
                    clockOffset = serverTime - clientTime;
                }

                // El servidor dice que ya no hay proceso: se limpia todo. Antes
                // esto solo entraba si localmente creíamos estar corriendo, así
                // que un estado a medias se quedaba pegado en la pantalla.
                if (terminalStates.includes(status) || !processId) {
                    if (this.currentStatus !== status || this.currentProcessId !== null) {
                        console.log(`El servidor indica que no hay proceso en curso (${status}). Limpiando pantalla...`);
                        this.clearProcessState();
                        this.updateProcessStatus(status);
                    }
                    return;
                }

                // Corrida distinta de la que teníamos: se adopta desde cero. Es
                // el caso que dejaba rastros del proceso anterior, porque con el
                // mismo texto de estado no se refrescaba nada.
                if (processId !== this.currentProcessId) {
                    console.log(`Proceso nuevo detectado (id ${processId}). Sincronizando con el servidor...`);
                    this.clearProcessState();
                    this.currentProcessId = processId;
                    // El arranque real lo tiene el servidor. Se corrige por el
                    // desfase de reloj para que el cronómetro no salga torcido
                    // si el PC va desajustado respecto a MySQL.
                    // El transcurrido preferido es el que calcula MySQL con
                    // TIMESTAMPDIFF: no depende ni de la zona horaria del motor
                    // ni del reloj del equipo. El startTime crudo queda como
                    // respaldo, corregido por el desfase de reloj.
                    const inicioServidor = result.process.startTime
                        ? new Date(result.process.startTime).getTime()
                        : null;
                    this.startTime = result.process.elapsedSeconds != null
                        ? Date.now() - result.process.elapsedSeconds * 1000
                        : (inicioServidor ? inicioServidor - clockOffset : Date.now());
                }

                // Se sincroniza siempre contra el servidor, no solo cuando el
                // texto cambia: el servidor reconcilia el estado con la placa y
                // es quien tiene la razón sobre si está corriendo o pausado.
                if (this.currentStatus !== status) {
                    this.updateProcessStatus(status);
                }

                this.showTimer();

                if (status === 'running') {
                    this.marcarReanudado();
                    if (!this.isTimerRunning) this.startTimer();
                } else if (status === 'paused') {
                    this.marcarPausado();
                    this.forceStopTimer();
                    this.updateTimerDisplay();
                }
            }
        } catch (error) {
            console.error('Error cargando estado del proceso:', error);
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

            // Y que no haya ya una corriendo. El servidor responde 409 de todas
            // formas, pero cortar aquí evita limpiar el cronómetro de la receta
            // que sí está en curso por un arranque que iba a ser rechazado.
            if (this.app.hayProcesoEnCurso()) {
                this.app.showError('Ya hay un proceso ejecutándose. Debe detenerlo antes de iniciar uno nuevo.');
                return;
            }

            // CRÍTICO: Limpiar COMPLETAMENTE cualquier timer existente ANTES de iniciar
            console.log('Iniciando proceso - Limpiando timers anteriores...');
            this.forceStopTimer();
            this.resetTimerDisplay();
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
                this.pausedAccumMs = 0;
                this.pausedSinceMs = null;
                this.currentProcessId = result.processId || null;
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
                this.marcarPausado();
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
                this.marcarReanudado();
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
                    this.clearProcessState();

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
            statusElement.className = `badge ${this.getStatusBadgeClass(status)} fs-6`;
        }

        // Update button states based on status
        this.updateButtonStates(status);

        // Emitir evento para que otras pantallas se actualicen
        document.dispatchEvent(new CustomEvent('process-status-changed', {
            detail: { status: status }
        }));

        const terminalStates = ['completed', 'cancelled', 'failed', 'error'];
        if (terminalStates.includes(status)) {
            console.log(`Proceso finalizado con estado: ${status}. Redirigiendo a Home en 3 segundos...`);
            setTimeout(() => {
                if (this.app.currentScreen === 'process' || !this.app.currentScreen) {
                    this.app.navigateTo('dashboard');
                    this.app.showInfo('Regresando a Home tras finalizar el proceso');
                }
            }, 3000);
        }
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
            timerElement.style.visibility = 'visible';
            timerElement.classList.add('timer-active');
        }
    }

    hideTimer() {
        const timerElement = document.getElementById('process-timer');
        if (timerElement) {
            timerElement.style.visibility = 'hidden';
            timerElement.classList.remove('timer-active');
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
        this.updateTimerDisplay();

        // Crear el nuevo intervalo
        this.timer = setInterval(() => {
            this.updateTimerDisplay();
        }, 1000);

        console.log('✅ Timer iniciado con startTime:', new Date(this.startTime).toISOString());
    }

    updateTimerDisplay() {
        const timerDisplay = document.getElementById('timer-display');
        if (!timerDisplay) return;

        // Si no hay startTime, no podemos calcular nada (mostrar 0 o nada)
        if (!this.startTime || typeof this.startTime !== 'number') {
            timerDisplay.textContent = '00:00:00';
            return;
        }

        // El tiempo que estuvo en pausa no cuenta como tiempo de proceso.
        const enPausa = this.pausedSinceMs !== null ? Date.now() - this.pausedSinceMs : 0;
        const elapsed = Math.max(0, Date.now() - this.startTime - this.pausedAccumMs - enPausa);
        const hours = Math.floor(elapsed / 3600000);
        const minutes = Math.floor((elapsed % 3600000) / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);

        timerDisplay.textContent =
            `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    /**
     * Deja la pantalla como si no hubiera proceso: sin cronómetro, sin id, sin
     * etapa y sin el tiempo de pausa acumulado. Todo junto en un sitio porque
     * olvidarse de uno de ellos es lo que dejaba rastros de la corrida anterior.
     */
    clearProcessState() {
        this.forceStopTimer();
        this.hideTimer();
        this.resetTimerDisplay();
        this.startTime = null;
        this.currentProcessId = null;
        this.pausedAccumMs = 0;
        this.pausedSinceMs = null;
        this.updateStageBadge(null);
    }

    /** Abre el conteo de la pausa. Idempotente: pausar dos veces no suma dos. */
    marcarPausado() {
        if (this.pausedSinceMs === null) {
            this.pausedSinceMs = Date.now();
        }
    }

    /** Cierra la pausa en curso y la acumula para descontarla del cronómetro. */
    marcarReanudado() {
        if (this.pausedSinceMs !== null) {
            this.pausedAccumMs += Date.now() - this.pausedSinceMs;
            this.pausedSinceMs = null;
        }
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
    }

    resetTimerDisplay() {
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
                        <div class="card-body py-3">
                            <div class="text-center py-3">
                                <i class="bi bi-gear text-muted" style="font-size: 3rem;"></i>
                                <h5 class="mt-2 mb-2">Control de Procesos</h5>
                                <p class="text-muted small mb-2">Gestión de ejecución del sistema</p>
                                <div class="d-flex flex-column align-items-center gap-2">
                                    <span class="badge bg-secondary fs-5 py-2 px-3" id="process-status">Detenido</span>
                                    <span class="badge bg-info fs-6 py-2 px-3 d-none" id="process-stage"></span>
                                    <div id="process-timer" style="visibility: hidden;">
                                        <span class="badge bg-dark fs-3 py-2 px-4" id="timer-display">00:00:00</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="process-controls mt-3">
                                <div class="row g-4 justify-content-center">
                                    <div class="col-lg-4 col-md-5 col-sm-6">
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
                                    
                                    <div class="col-lg-4 col-md-5 col-sm-6">
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
