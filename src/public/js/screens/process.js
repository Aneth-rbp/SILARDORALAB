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
        this.currentStatus = 'stopped'; // Almacenar el estado actual
        // Candado del boton pausar/reanudar. Sin el, cada clic mandaba su
        // comando a la placa sin esperar al anterior: machacando el boton se
        // encolaban PAUSE y RESUME contra un Arduino que aun estaba a media
        // maniobra.
        this.cambiandoPausa = false;
        this.init();
    }

    destroy() {
        console.log('ProcessScreen destroyed');
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
                }

                // Se sincroniza siempre contra el servidor, no solo cuando el
                // texto cambia: el servidor reconcilia el estado con la placa y
                // es quien tiene la razón sobre si está corriendo o pausado.
                if (this.currentStatus !== status) {
                    this.updateProcessStatus(status);
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
        document.getElementById('pause-process-btn')?.addEventListener('click', async () => {
            if (this.cambiandoPausa) return;

            this.cambiandoPausa = true;
            const boton = document.getElementById('pause-process-btn');
            if (boton) boton.disabled = true;

            try {
                if (this.currentStatus === 'paused') {
                    await this.resumeProcess();
                } else {
                    await this.pauseProcess();
                }
            } finally {
                this.cambiandoPausa = false;
                // updateButtonStates decide si vuelve a habilitarse segun el
                // estado que quedo, asi que no se reactiva a ciegas.
                this.updateButtonStates(this.currentStatus);
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

            const result = await this.app.apiCall('/process/start', {
                method: 'POST',
                body: JSON.stringify({
                    recipeId: this.selectedRecipeId
                })
            });

            if (result && result.success) {
                this.app.showSuccess(result.message || 'Proceso iniciado correctamente');
                this.updateProcessStatus('running');

                this.currentProcessId = result.processId || null;

                // El cronómetro vive en el encabezado de la aplicación, que se
                // refresca cada 5 segundos. Se le avisa ya para que aparezca al
                // instante en vez de esperar al siguiente sondeo.
                this.app.refrescarEstadoDelProceso();

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
            }

        } catch (error) {
            const errorMessage = error.message || 'Error reanudando el proceso';
            this.app.showError(errorMessage);
            // Recargar el estado para sincronizar
            this.loadProcessStatus();
        }
    }

    async stopProcess() {
        const detener = await confirmar('¿Está seguro que desea detener el proceso?', {
            titulo: 'Detener proceso',
            aceptar: 'Detener',
            tipo: 'peligro'
        });

        if (detener) {
            try {
                const result = await this.app.apiCall('/process/stop', {
                    method: 'POST'
                });

                if (result && result.success) {
                    this.app.showSuccess(result.message || 'Proceso detenido');
                    this.updateProcessStatus('stopped');

                    this.clearProcessState();

                    // El encabezado se entera enseguida de que ya no hay nada
                    // corriendo, sin esperar a su sondeo de cada 5 segundos.
                    this.app.refrescarEstadoDelProceso();

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

    /**
     * Deja la pantalla como si no hubiera proceso: sin id y sin etapa. El
     * tiempo transcurrido ya no se pinta aquí, lo lleva el encabezado.
     */
    clearProcessState() {
        this.currentProcessId = null;
        this.updateStageBadge(null);
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
