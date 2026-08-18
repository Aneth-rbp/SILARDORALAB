/**
 * Recipes Screen - Gestión de recetas del sistema SILAR
 * Equivale a las pantallas 2, 3 y 4 del diseño original
 */

class RecipesScreen {
    // Topes físicos de los ejes, en mm/s. No son configurables desde la base:
    // salen de las constantes de SILAR_Control.ino, donde MAX_SPEED_Y y
    // MAX_SPEED_Z valen 2000 pasos/s. Con PASOS_POR_MM_Y = 4200 pasos / 55 mm
    // entre vasos quedan ~26 mm/s en Y, y con los 20 pasos/mm de fábrica de Z
    // quedan 100 mm/s. El firmware recorta solo y avisa por serial si se pasan,
    // pero conviene que el operador se entere antes de guardar la receta.
    // Las escalas de los DOS ejes son recalibrables desde Configuración, así que
    // los topes reales pueden moverse; estos valores son los de fábrica. El tope
    // vigente de Y lo publica el firmware en CAL_Y (campo vmax) y se ve en el
    // panel de geometría; pasarse de aquí no rompe nada, solo hace que el
    // firmware recorte y avise.
    static MAX_TRANSFER_SPEED_MMS = 26;
    static MAX_Z_SPEED_MMS = 100;

    // Recorrido útil del eje Y en mm: el final de carrera está en 14027 pasos y
    // con los 76.36 pasos/mm de fábrica salen 183.7 mm. Es el tope para las
    // posiciones de vaso de la receta. Mismo criterio que arriba: el firmware
    // recorta y avisa, pero es mejor decírselo al operador antes de guardar.
    static MAX_VESSEL_POSITION_MM = 183;

    // Tope de etapas de una receta por etapas. Tiene que coincidir con
    // SilarWebServer.MAX_STAGES y con MAX_ETAPAS del firmware, porque la lista
    // de etapas vive en la memoria del Arduino: si aquí se permitieran más, la
    // receta se guardaría entera y el Arduino rechazaría las sobrantes en mitad
    // de la carga, con el proceso ya a medio arrancar.
    static MAX_STAGES = 8;

    // Campos que hay que leer como entero al recogerlos del formulario de
    // etapas. El resto son decimales (mm, mm/s, °C).
    static STAGE_INT_FIELDS = new Set([
        'dippingWait0', 'dippingWait1', 'dippingWait2', 'dippingWait3',
        'transferWait', 'cycles'
    ]);

    constructor(app) {
        this.app = app;
        this.recipes = [];
        this.selectedRecipe = null;
        this.currentUser = this.app.userSession;
        this.systemConfig = null; // Configuraciones del sistema (límites y defaults)
        this.processStatus = null; // Estado del proceso actual
        this.processStatusCheckInterval = null; // Intervalo para verificar estado del proceso

        // Etapas que se están editando en el formulario. Viven aquí y no solo en
        // el DOM porque agregar, mover o borrar una etapa repinta la lista
        // entera: lo escrito se vuelca aquí antes de cada cambio.
        this.stagesDraft = [];
        this.stageAbierta = 0;
        
        // Binds para poder remover listeners
        this.handleRecipeSelection = this.handleRecipeSelection.bind(this);
        this.handleProcessStatusChanged = this.handleProcessStatusChanged.bind(this);
        
        this.init();
    }

    getCreatorBadgeColor(creatorRole) {
        const colors = {
            'admin': 'bg-danger',
            'usuario': 'bg-primary'
        };
        return colors[creatorRole] || 'bg-secondary';
    }

    canUserEditRecipe(recipe) {
        if (!this.currentUser) return false;
        
        // Admins pueden editar todo
        if (this.currentUser.role === 'admin') return true;
        
        // Usuarios pueden editar sus propias recetas
        if (recipe.created_by_user_id === this.currentUser.userId) return true;
        
        return false;
    }

    async init() {
        await this.loadSystemConfig();
        await this.loadRecipes();
        this.bindEvents();
        await this.checkProcessStatus();
        // Verificar estado del proceso cada 5 segundos
        this.startProcessStatusMonitoring();
        
        // Escuchar eventos de cambio de estado del proceso
        document.addEventListener('process-status-changed', this.handleProcessStatusChanged);
    }

    handleProcessStatusChanged() {
        this.checkProcessStatus();
    }

    destroy() {
        console.log('RecipesScreen destroyed');
        this.stopProcessStatusMonitoring();
        
        // Remover modal del body si existe. dispose() antes de remove(): si el
        // modal sigue abierto, Bootstrap se lleva su backdrop; borrando solo el
        // markup queda el backdrop tapando la aplicacion entera.
        const modalElement = document.getElementById('recipe-form-modal');
        if (modalElement) {
            bootstrap.Modal.getInstance(modalElement)?.dispose();
            modalElement.remove();
        }
        
        // Remover listeners globales
        document.removeEventListener('click', this.handleRecipeSelection);
        document.removeEventListener('process-status-changed', this.handleProcessStatusChanged);
    }

    /**
     * Carga las configuraciones del sistema para usar como límites y valores por defecto
     */
    async loadSystemConfig() {
        try {
            // Intentar cargar límites (endpoint público para todos los usuarios autenticados)
            const response = await this.app.apiCall('/config/limits');
            if (response.success && response.limits) {
                this.systemConfig = response.limits;
            } else {
                throw new Error('No se pudieron cargar los límites');
            }
        } catch (error) {
            // Si no se puede cargar, usar valores por defecto
            console.warn('No se pudieron cargar las configuraciones del sistema, usando valores por defecto');
            this.systemConfig = {
                max_velocity_y: 1000,
                max_velocity_z: 1000,
                max_accel_y: 100,
                max_accel_z: 100,
                humidity_offset: 0,
                temperature_offset: 0
            };
        }
    }

    /**
     * Verifica el estado actual del proceso.
     *
     * Ya no consulta la API por su cuenta: lee el estado que la aplicación
     * mantiene vivo todo el tiempo. Así el botón de ejecutar nace deshabilitado
     * al entrar a Recetas con una receta corriendo, en vez de habilitarse un
     * instante hasta que respondiera el primer sondeo propio de la pantalla.
     */
    checkProcessStatus() {
        this.processStatus = this.app.hayProcesoEnCurso()
            ? this.app.procesoEnCurso.status
            : 'stopped';
        this.updateActionButtons();
    }

    /**
     * Inicia el monitoreo periódico del estado del proceso
     */
    startProcessStatusMonitoring() {
        // Limpiar intervalo anterior si existe
        if (this.processStatusCheckInterval) {
            clearInterval(this.processStatusCheckInterval);
        }
        
        // Es solo leer el estado en memoria, no hay red de por medio, así que
        // se puede refrescar cada segundo sin costo.
        this.processStatusCheckInterval = setInterval(() => {
            this.checkProcessStatus();
        }, 1000);
    }

    /**
     * Detiene el monitoreo del estado del proceso
     */
    stopProcessStatusMonitoring() {
        if (this.processStatusCheckInterval) {
            clearInterval(this.processStatusCheckInterval);
            this.processStatusCheckInterval = null;
        }
    }

    bindEvents() {
        // Nuevo recipe button
        document.getElementById('new-recipe-btn')?.addEventListener('click', () => {
            this.showRecipeForm();
        });

        // Recipe selection
        document.addEventListener('click', this.handleRecipeSelection);

        // Execute recipe button
        document.getElementById('execute-recipe-btn')?.addEventListener('click', () => {
            this.executeSelectedRecipe();
        });

        // Edit recipe button
        document.getElementById('edit-recipe-btn')?.addEventListener('click', () => {
            this.editSelectedRecipe();
        });

        // Delete recipe button
        document.getElementById('delete-recipe-btn')?.addEventListener('click', () => {
            this.deleteSelectedRecipe();
        });

        // Search functionality
        document.getElementById('recipe-search')?.addEventListener('input', (e) => {
            this.filterRecipes(e.target.value);
        });
    }

    handleRecipeSelection(e) {
        if (e.target.closest('.recipe-card')) {
            const recipeId = e.target.closest('.recipe-card').getAttribute('data-recipe-id');
            this.selectRecipe(recipeId);
        }
    }

    filterRecipes(searchTerm) {
        const searchLower = searchTerm.toLowerCase().trim();
        const recipeCards = document.querySelectorAll('.recipe-card');
        
        recipeCards.forEach(card => {
            const recipeName = card.querySelector('.recipe-name-main')?.textContent.toLowerCase() || '';
            const recipeDescription = card.querySelector('.recipe-description')?.textContent.toLowerCase() || '';
            const creatorName = card.querySelector('.creator-info span')?.textContent.toLowerCase() || '';
            
            const matches = recipeName.includes(searchLower) || 
                           recipeDescription.includes(searchLower) || 
                           creatorName.includes(searchLower);
            
            card.style.display = matches ? 'flex' : 'none';
        });

        // Mostrar mensaje si no hay resultados
        const visibleCards = document.querySelectorAll('.recipe-card[style*="flex"]');
        const noResultsMsg = document.getElementById('no-results-message');
        
        if (visibleCards.length === 0 && searchTerm) {
            if (!noResultsMsg) {
                const recipesList = document.getElementById('recipes-list');
                const message = document.createElement('div');
                message.id = 'no-results-message';
                message.className = 'empty-state';
                message.innerHTML = `
                    <div class="empty-icon">
                        <i class="bi bi-search"></i>
                    </div>
                    <h4>No se encontraron recetas</h4>
                    <p>Intente con otros términos de búsqueda</p>
                `;
                recipesList.appendChild(message);
            }
        } else if (noResultsMsg) {
            noResultsMsg.remove();
        }
    }

    async loadRecipes() {
        const container = document.getElementById('recipes-list');
        
        try {
            const response = await this.app.apiCall('/recipes');
            
            // Asegurarse de que siempre sea un array
            this.recipes = Array.isArray(response) ? response : [];
            
            console.log('Recetas cargadas:', this.recipes.length);
            if (this.recipes.length > 0) {
                console.log('Primera receta cargada:', {
                    id: this.recipes[0].id,
                    name: this.recipes[0].name,
                    parameters: this.recipes[0].parameters
                });
            }
            
            this.renderRecipesList();
        } catch (error) {
            console.error('Error loading recipes:', error);
            this.recipes = []; // Asegurar que sea un array vacío en caso de error
            
            // Ocultar el estado de carga y mostrar mensaje de error
            if (container) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon">
                            <i class="bi bi-exclamation-triangle text-danger"></i>
                        </div>
                        <h4>Error al cargar las recetas</h4>
                        <p>No se pudieron cargar las recetas. Por favor, intente nuevamente.</p>
                        <button class="btn btn-primary" onclick="window.silarApp.navigateToScreen('recipes')">
                            <i class="bi bi-arrow-clockwise me-2"></i>Reintentar
                        </button>
                    </div>
                `;
            }
            
            this.app.showError('Error cargando las recetas');
        }
    }

    renderRecipesList() {
        const container = document.getElementById('recipes-list');
        if (!container) return;

        // Asegurarse de que recipes sea un array
        if (!Array.isArray(this.recipes)) {
            this.recipes = [];
        }

        if (this.recipes.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">
                        <i class="bi bi-journal-plus"></i>
                    </div>
                    <h4>No hay recetas disponibles</h4>
                    <p>Cree su primera receta para comenzar</p>
                    <button class="btn btn-primary" onclick="this.showRecipeForm()">
                        <i class="bi bi-plus-lg me-2"></i>Nueva Receta
                    </button>
                </div>
            `;
            return;
        }

        // Limpiar el contenedor
        container.innerHTML = '';
        
        // Crear elementos DOM en lugar de usar innerHTML para preservar UTF-8
        this.recipes.forEach(recipe => {
            const creatorBadgeColor = this.getCreatorBadgeColor(recipe.creator_role);
            const userCanEdit = this.canUserEditRecipe(recipe);
            const isSelected = this.selectedRecipe?.id === recipe.id;
            
            const card = document.createElement('div');
            card.className = `recipe-card compact ${isSelected ? 'selected' : ''}`;
            card.setAttribute('data-recipe-id', recipe.id);
            
            card.innerHTML = `
                <div class="recipe-header">
                    <div class="recipe-name-main"></div>
                    <span class="badge bg-info recipe-stage-badge"></span>
                    <div class="recipe-type-badge"></div>
                </div>
                <div class="recipe-description"></div>
                <div class="recipe-meta-info">
                    <div class="creator-info">
                        <i class="bi bi-person-circle"></i>
                        <span></span>
                    </div>
                    <div class="date-info">
                        <i class="bi bi-calendar"></i>
                        <span></span>
                    </div>
                </div>
            `;
            
            // Usar textContent para preservar UTF-8 correctamente
            card.querySelector('.recipe-name-main').textContent = recipe.name || '';
            card.querySelector('.recipe-type-badge').textContent = recipe.type || 'A';
            card.querySelector('.recipe-description').textContent = recipe.description || 'Sin descripción';
            card.querySelector('.creator-info span').textContent = recipe.created_by_name || '';
            card.querySelector('.date-info span').textContent = new Date(recipe.created_at).toLocaleDateString('es-ES');

            // Una receta por etapas se distingue en la lista: al ejecutarla corre
            // una secuencia entera, no un solo juego de parámetros.
            const distintivoEtapas = card.querySelector('.recipe-stage-badge');
            const numeroEtapas = Array.isArray(recipe.stages)
                ? recipe.stages.length
                : (recipe.stage_count || 0);
            if (recipe.is_staged) {
                distintivoEtapas.textContent = numeroEtapas ? `${numeroEtapas} etapas` : 'Por etapas';
            } else {
                distintivoEtapas.remove();
            }
            
            container.appendChild(card);
        });
    }

    selectRecipe(recipeId) {
        this.selectedRecipe = this.recipes.find(r => r.id == recipeId);
        
        // Update visual selection
        document.querySelectorAll('.recipe-card').forEach(card => {
            card.classList.remove('active');
        });
        
        const selectedCard = document.querySelector(`[data-recipe-id="${recipeId}"]`);
        if (selectedCard) {
            selectedCard.classList.add('active');
        }

        // Update recipe details
        this.updateRecipeDetails();
        
        // Show/hide action bar
        const actionBar = document.getElementById('action-bar');
        if (actionBar) {
            actionBar.style.display = this.selectedRecipe ? 'block' : 'none';
        }
        
        // Enable action buttons
        this.updateActionButtons();
    }

    highlightSelectedRecipe() {
        // Remover selección anterior
        document.querySelectorAll('.recipe-card').forEach(card => {
            card.classList.remove('selected');
        });
        
        // Resaltar la receta seleccionada
        if (this.selectedRecipe) {
            const selectedCard = document.querySelector(`[data-recipe-id="${this.selectedRecipe.id}"]`);
            if (selectedCard) {
                selectedCard.classList.add('selected');
            }
        }
    }

    updateRecipeDetails() {
        const detailsContainer = document.getElementById('recipe-details');
        if (!detailsContainer || !this.selectedRecipe) return;

        const recipe = this.selectedRecipe;
        const params = recipe.parameters || {};
        const etapas = Array.isArray(recipe.stages) ? recipe.stages : [];

        // En una receta por etapas, los parámetros de arriba son el resumen
        // (duración y ciclos totales, el resto de la primera etapa). El detalle
        // real es la secuencia.
        const etapasHtml = recipe.is_staged && etapas.length > 0 ? `
            <div class="stages-summary mt-3">
                <h6 class="fw-bold text-primary">
                    <i class="bi bi-list-ol me-2"></i>Etapas (${etapas.length})
                </h6>
                <p class="text-muted small mb-2">
                    Se ejecutan seguidas en una sola corrida, sin home ni pausa entre una y la siguiente.
                </p>
                <ol class="mb-0 ps-3">
                    ${etapas.map((etapa, i) => `
                        <li class="small mb-1">
                            <strong>${this.escapeHtml(etapa.name || `Etapa ${i + 1}`)}</strong>
                            — ${etapa.cycles || 0} ciclos · ~${this.stageDurationMinutes(etapa)} min
                            <span class="text-muted">
                                (inmersiones ${etapa.dippingWait0 || 0}/${etapa.dippingWait1 || 0}/${etapa.dippingWait2 || 0}/${etapa.dippingWait3 || 0} ms,
                                Z ${etapa.dipSpeed || '--'}/${etapa.emersionSpeed || etapa.dipSpeed || '--'} mm/s, ventilador ${etapa.fan ? 'encendido' : 'apagado'})
                            </span>
                        </li>`).join('')}
                </ol>
            </div>` : '';
        
        // Debug: mostrar los parámetros en la consola
        console.log('Receta seleccionada:', recipe.name);
        console.log('Parámetros recibidos:', params);
        console.log('Tipo de parámetros:', typeof params);

        detailsContainer.innerHTML = `
            <div class="recipe-details-card">
                <div class="details-header">
                    <i class="bi bi-info-circle"></i>
                    <h5>Detalles de la Receta</h5>
                </div>
                
                <div class="details-content">
                    <div class="recipe-name">
                        ${recipe.name}
                        ${recipe.is_staged ? '<span class="badge bg-info ms-2">Por etapas</span>' : ''}
                    </div>
                    
                    <div class="params-grid">
                        <div class="param-item">
                            <span class="param-label">Duración ${recipe.is_staged ? 'total' : 'estimada'}</span>
                            <span class="param-value">${params.duration || '--'} min</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Temperatura</span>
                            <span class="param-value">${params.temperature || '--'} °C</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Offset Humedad</span>
                            <span class="param-value">${params.humidityOffset || '--'} %</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Offset Temp.</span>
                            <span class="param-value">${params.temperatureOffset || '--'} °C</span>
                        </div>
                        <!-- Tiempos de Inmersión -->
                        <div class="param-item">
                            <span class="param-label">Tiempo Inmersión 1</span>
                            <span class="param-value">${params.dippingWait0 || '--'} ms</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Tiempo Inmersión 2</span>
                            <span class="param-value">${params.dippingWait1 || '--'} ms</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Tiempo Inmersión 3</span>
                            <span class="param-value">${params.dippingWait2 || '--'} ms</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Tiempo Inmersión 4</span>
                            <span class="param-value">${params.dippingWait3 || '--'} ms</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Tiempo Transferencia Y</span>
                            <span class="param-value">${params.transferWait || '--'} ms</span>
                        </div>
                        <!-- Parámetros de Proceso -->
                        <div class="param-item">
                            <span class="param-label">Ciclos${recipe.is_staged ? ' (total)' : ''}</span>
                            <span class="param-value">${params.cycles || '--'}</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Ventilador</span>
                            <span class="param-value">${params.fan ? 'Activado' : 'Desactivado'}</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Excluir Inmersiones</span>
                            <span class="param-value">
                                ${[
                                    params.exceptDripping1 ? 'Y1' : '',
                                    params.exceptDripping2 ? 'Y2' : '',
                                    params.exceptDripping3 ? 'Y3' : '',
                                    params.exceptDripping4 ? 'Y4' : ''
                                ].filter(x => x).join(', ') || 'Ninguna'}
                            </span>
                        </div>
                    </div>

                    ${etapasHtml}
                </div>
            </div>
                </div>
            </div>
        `;
    }

    updateActionButtons() {
        const executeBtn = document.getElementById('execute-recipe-btn');
        const editBtn = document.getElementById('edit-recipe-btn');
        const deleteBtn = document.getElementById('delete-recipe-btn');

        const hasSelection = !!this.selectedRecipe;
        const hasRunningProcess = this.processStatus === 'running' || this.processStatus === 'paused';

        if (executeBtn) {
            // Deshabilitar si no hay selección O si hay un proceso ejecutándose
            executeBtn.disabled = !hasSelection || hasRunningProcess;
            
            if (hasSelection && !hasRunningProcess) {
                executeBtn.classList.remove('btn-secondary');
                executeBtn.classList.add('btn-execute');
                executeBtn.title = 'Ejecutar receta';
            } else {
                executeBtn.classList.remove('btn-execute');
                executeBtn.classList.add('btn-secondary');
                if (hasRunningProcess) {
                    executeBtn.title = 'Hay un proceso ejecutándose. Debe detenerlo antes de iniciar otro.';
                } else {
                    executeBtn.title = 'Seleccione una receta para ejecutar';
                }
            }
        }
        
        if (editBtn) {
            editBtn.disabled = !hasSelection;
            if (hasSelection) {
                editBtn.classList.remove('btn-secondary');
                editBtn.classList.add('btn-edit');
            } else {
                editBtn.classList.remove('btn-edit');
                editBtn.classList.add('btn-secondary');
            }
        }
        
        if (deleteBtn) {
            deleteBtn.disabled = !hasSelection;
            if (hasSelection) {
                deleteBtn.classList.remove('btn-secondary');
                deleteBtn.classList.add('btn-delete');
            } else {
                deleteBtn.classList.remove('btn-delete');
                deleteBtn.classList.add('btn-secondary');
            }
        }
    }

    showRecipeForm(recipe = null) {
        const modalElement = document.getElementById('recipe-form-modal');
        if (modalElement && modalElement.parentNode !== document.body) {
            // Eliminar cualquier modal viejo en el body antes de mover el nuevo
            const oldModal = document.querySelector('body > #recipe-form-modal');
            if (oldModal && oldModal !== modalElement) {
                bootstrap.Modal.getInstance(oldModal)?.dispose();
                oldModal.remove();
            }
            document.body.appendChild(modalElement);
        }

        let modal = bootstrap.Modal.getInstance(modalElement);
        if (!modal) {
            modal = new bootstrap.Modal(modalElement, { focus: false });
        }
        
        // Initialize form
        this.initRecipeForm(recipe);
        modal.show();
    }

    initRecipeForm(recipe) {
        const form = document.getElementById('recipe-form');
        if (!form) return;

        // Obtener configuraciones del sistema (límites y defaults)
        const config = this.systemConfig || {};
        const defaultHumidityOffset = config.humidity_offset || 0;
        const defaultTempOffset = config.temperature_offset || 0;

        if (recipe) {
            // Edit mode
            const params = recipe.parameters || {};
            form.querySelector('#recipe-name').value = recipe.name || '';
            form.querySelector('#recipe-type').value = recipe.type || 'A';
            form.querySelector('#recipe-description').value = recipe.description || '';
            form.querySelector('#recipe-duration').value = params.duration || '';
            form.querySelector('#recipe-temperature').value = params.temperature || '';
            form.querySelector('#recipe-humidity-offset').value = params.humidityOffset || '';
            form.querySelector('#recipe-temp-offset').value = params.temperatureOffset || '';
            // Tiempos de inmersión
            form.querySelector('#recipe-dipping-wait0').value = params.dippingWait0 || '';
            form.querySelector('#recipe-dipping-wait1').value = params.dippingWait1 || '';
            form.querySelector('#recipe-dipping-wait2').value = params.dippingWait2 || '';
            form.querySelector('#recipe-dipping-wait3').value = params.dippingWait3 || '';
            form.querySelector('#recipe-transfer-wait').value = params.transferWait || '';
            // Parámetros de proceso
            form.querySelector('#recipe-cycles').value = params.cycles || 1;
            form.querySelector('#recipe-fan').value = params.fan ? 'true' : 'false';
            form.querySelector('#recipe-except-dripping1').checked = params.exceptDripping1 || false;
            form.querySelector('#recipe-except-dripping2').checked = params.exceptDripping2 || false;
            form.querySelector('#recipe-except-dripping3').checked = params.exceptDripping3 || false;
            form.querySelector('#recipe-except-dripping4').checked = params.exceptDripping4 || false;
            // Posiciones
            form.querySelector('#recipe-dip-start-position').value = params.dipStartPosition || '';
            form.querySelector('#recipe-dipping-length').value = params.dippingLength || '';
            form.querySelector('#recipe-transfer-speed').value = params.transferSpeed || '';
            form.querySelector('#recipe-dip-speed').value = params.dipSpeed || '';
            // Vacío = subir a la misma velocidad de bajada. Se deja en blanco en
            // vez de escribir un 0, que parecería una velocidad elegida a propósito.
            form.querySelector('#recipe-emersion-speed').value = params.emersionSpeed || '';
            // Posición de cada vaso. Se deja el campo vacío cuando vale 0, que es
            // como se dice "usa la geometría calibrada de la máquina": un 0 escrito
            // parecería una posición elegida a propósito.
            for (let i = 1; i <= 4; i++) {
                const campo = form.querySelector(`#recipe-pos-y${i}`);
                if (campo) campo.value = params[`posY${i}`] || '';
            }
            
            document.getElementById('recipe-form-title').textContent = 'Editar Receta';
            document.getElementById('save-recipe-btn').textContent = 'Actualizar Receta';
            

        } else {
            // New mode - usar valores por defecto de configuración
            form.reset();
            form.querySelector('#recipe-type').value = 'A';
            
            // Aplicar valores por defecto de offsets
            form.querySelector('#recipe-humidity-offset').value = defaultHumidityOffset;
            form.querySelector('#recipe-temp-offset').value = defaultTempOffset;
            
            document.getElementById('recipe-form-title').textContent = 'Nueva Receta';
            document.getElementById('save-recipe-btn').textContent = 'Guardar Receta';
        }

        // Aplicar límites máximos a los campos. Los tres llegan al firmware y van
        // en mm/s, con el tope físico del eje: no se leen de la configuración
        // porque no son ajustables, los fija la mecánica (ver
        // MAX_TRANSFER_SPEED_MMS / MAX_Z_SPEED_MMS).
        const transferSpeedInput = form.querySelector('#recipe-transfer-speed');   // Velocidad de transferencia Y
        const dipSpeedInput = form.querySelector('#recipe-dip-speed');             // Bajada del eje Z
        const emersionSpeedInput = form.querySelector('#recipe-emersion-speed');   // Subida del eje Z

        if (transferSpeedInput) {
            transferSpeedInput.setAttribute('max', RecipesScreen.MAX_TRANSFER_SPEED_MMS);
            transferSpeedInput.setAttribute('title', `Máximo: ${RecipesScreen.MAX_TRANSFER_SPEED_MMS} mm/s`);
        }
        if (dipSpeedInput) {
            dipSpeedInput.setAttribute('max', RecipesScreen.MAX_Z_SPEED_MMS);
            dipSpeedInput.setAttribute('title', `Máximo: ${RecipesScreen.MAX_Z_SPEED_MMS} mm/s. Solo la bajada a la solución.`);
        }
        if (emersionSpeedInput) {
            emersionSpeedInput.setAttribute('max', RecipesScreen.MAX_Z_SPEED_MMS);
            emersionSpeedInput.setAttribute('title', `Máximo: ${RecipesScreen.MAX_Z_SPEED_MMS} mm/s. Vacío = subir a la misma velocidad de la inmersión.`);
        }

        for (let i = 1; i <= 4; i++) {
            const campo = form.querySelector(`#recipe-pos-y${i}`);
            if (!campo) continue;
            campo.setAttribute('max', RecipesScreen.MAX_VESSEL_POSITION_MM);
            campo.setAttribute('title', `Máximo: ${RecipesScreen.MAX_VESSEL_POSITION_MM} mm. Vacío = usar la posición calibrada de la máquina.`);
        }

        // Modo de la receta. Las recetas que ya existían no llevan is_staged, así
        // que abren en modo normal y el formulario se comporta como siempre.
        this.stagesDraft = recipe && Array.isArray(recipe.stages)
            ? recipe.stages.map(etapa => ({ ...etapa }))
            : [];
        this.stageAbierta = 0;

        const selectorModo = document.getElementById('recipe-mode');
        if (selectorModo) {
            selectorModo.onchange = () => this.setRecipeMode(selectorModo.value === 'staged');
        }

        const botonAgregarEtapa = document.getElementById('add-stage-btn');
        if (botonAgregarEtapa) {
            botonAgregarEtapa.onclick = () => this.addStage();
        }

        this.setRecipeMode(!!(recipe && recipe.is_staged));

        // Agregar validación en tiempo real
        this.setupFormValidation(form);

        // NUEVO: Configurar autocálculo de duración
        this.setupAutoDurationCalculation(form);

        // Bind save event
        const saveBtn = document.getElementById('save-recipe-btn');
        saveBtn.onclick = () => this.saveRecipe(recipe?.id);
    }

    /**
     * Configura el cálculo automático de la duración basada en los parámetros
     */
    setupAutoDurationCalculation(form) {
        const durationInput = form.querySelector('#recipe-duration');
        if (durationInput) {
            durationInput.readOnly = true;
            durationInput.classList.add('bg-light');
            durationInput.style.cursor = 'not-allowed';
            durationInput.title = 'Calculado automáticamente según los parámetros de la receta';
        }

        // Lista de IDs que afectan a la duración
        const triggerIds = [
            'recipe-dipping-wait0', 'recipe-dipping-wait1', 'recipe-dipping-wait2', 'recipe-dipping-wait3',
            'recipe-transfer-wait', 'recipe-cycles', 'recipe-dip-speed', 'recipe-emersion-speed',
            'recipe-dipping-length'
        ];

        const updateFn = () => this.updateAutoDuration(form);

        triggerIds.forEach(id => {
            form.querySelector(`#${id}`)?.addEventListener('input', updateFn);
        });

        // Calcular valor inicial
        updateFn();
    }

    /**
     * Realiza el cálculo de duración y lo muestra en el formulario
     */
    updateAutoDuration(form) {
        if (!form) return;

        // Una receta por etapas dura lo que duran todas sus etapas seguidas: no
        // hay home ni pausa entre una y la siguiente, así que es la suma limpia.
        if (this.isStagedMode()) {
            const totalMs = this.stagesDraft.reduce(
                (suma, etapa) => suma + RecipesScreen.durationMs(etapa), 0);
            const totalMinutos = Math.ceil(totalMs / 60000);
            const campoDuracion = form.querySelector('#recipe-duration');
            if (campoDuracion) campoDuracion.value = totalMinutos > 0 ? totalMinutos : 1;
            return;
        }

        const dippingWait0 = parseInt(form.querySelector('#recipe-dipping-wait0').value) || 0;
        const dippingWait1 = parseInt(form.querySelector('#recipe-dipping-wait1').value) || 0;
        const dippingWait2 = parseInt(form.querySelector('#recipe-dipping-wait2').value) || 0;
        const dippingWait3 = parseInt(form.querySelector('#recipe-dipping-wait3').value) || 0;
        const transferWait = parseInt(form.querySelector('#recipe-transfer-wait').value) || 0;
        const cycles = parseInt(form.querySelector('#recipe-cycles').value) || 1;
        
        // Tiempo de movimiento (estimado)
        const dipSpeed = parseFloat(form.querySelector('#recipe-dip-speed').value) || 10; // mm/s
        // Vacío o 0 = sube a la misma velocidad con la que bajó.
        const emersionSpeed = parseFloat(form.querySelector('#recipe-emersion-speed').value) || dipSpeed;
        const dippingLength = parseFloat(form.querySelector('#recipe-dipping-length').value) || 50; // mm
        
        // Tiempo de bajar y subir por cada inmersión (2 movimientos, que ya no
        // tienen por qué durar lo mismo)
        const movementTimePerDipMs = RecipesScreen.tiempoInmersionMs(
            dippingLength, dipSpeed, emersionSpeed);
        
        // Suma de tiempos por ciclo
        const timePerCycleMs = (
            dippingWait0 + dippingWait1 + dippingWait2 + dippingWait3 + 
            (transferWait * 3) + // 3 transferencias entre vasos
            (movementTimePerDipMs * 4) // 4 inmersiones por ciclo
        );
        
        const totalTimeMs = timePerCycleMs * cycles;
        const totalMinutes = Math.ceil(totalTimeMs / 60000);
        
        const durationInput = form.querySelector('#recipe-duration');
        if (durationInput) {
            durationInput.value = totalMinutes > 0 ? totalMinutes : 1;
        }
    }

    /**
     * Configura validación en tiempo real para los campos del formulario
     */
    setupFormValidation(form) {
        // Los tres campos se validaban con bloques calcados que solo diferían en
        // el máximo y la unidad, y fue justo ahí donde las unidades se desviaron:
        // los de mm/s se comparaban contra topes en rpm. Con la tabla quedan a la
        // vista de un vistazo. Las tres velocidades llegan al firmware en mm/s y
        // su tope lo fija la mecánica del eje, no la configuración.
        const limites = [
            ['#recipe-transfer-speed', RecipesScreen.MAX_TRANSFER_SPEED_MMS, 'mm/s'],
            ['#recipe-dip-speed', RecipesScreen.MAX_Z_SPEED_MMS, 'mm/s'],
            ['#recipe-emersion-speed', RecipesScreen.MAX_Z_SPEED_MMS, 'mm/s']
        ];

        limites.forEach(([selector, maximo, unidad]) => {
            const input = form.querySelector(selector);
            if (!input) return;

            input.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value) || 0;
                if (value > maximo) {
                    e.target.classList.add('is-invalid');
                    e.target.setCustomValidity(`El valor máximo permitido es ${maximo} ${unidad}`);
                } else {
                    e.target.classList.remove('is-invalid');
                    e.target.setCustomValidity('');
                }
            });
        });
    }

    /**
     * Los parámetros de una etapa son los mismos de una receta normal: una
     * etapa ES una receta que se encadena con las siguientes. En vez de repetir
     * el bloque de campos ocho veces en el HTML se describen una sola vez aquí,
     * y de esta tabla salen tanto el formulario como la lectura de vuelta en
     * saveRecipe. Agregar un parámetro a la receta es agregar una fila.
     */
    static stageFieldGroups() {
        return [
            {
                title: 'Tiempos de Inmersión (ms)',
                icon: 'bi-clock-history',
                fields: [
                    { key: 'dippingWait0', label: 'Inmersión 1', min: 0, step: 100 },
                    { key: 'dippingWait1', label: 'Inmersión 2', min: 0, step: 100 },
                    { key: 'dippingWait2', label: 'Inmersión 3', min: 0, step: 100 },
                    { key: 'dippingWait3', label: 'Inmersión 4', min: 0, step: 100 },
                    { key: 'transferWait', label: 'Espera Transferencia Y', min: 0, step: 100 }
                ]
            },
            {
                title: 'Parámetros de Proceso',
                icon: 'bi-gear',
                fields: [
                    { key: 'cycles', label: 'Cantidad de Ciclos', min: 1, step: 1, defecto: 1 },
                    { key: 'fan', label: 'Ventilador', tipo: 'select',
                      opciones: [['false', 'Desactivado'], ['true', 'Activado']] },
                    { key: 'temperature', label: 'Temperatura (°C)', step: 0.1 },
                    { key: 'humidityOffset', label: 'Offset Humedad (%)', step: 0.1 },
                    { key: 'temperatureOffset', label: 'Offset Temperatura (°C)', step: 0.1 }
                ]
            },
            {
                title: 'Excluir Inmersión en Posiciones',
                icon: 'bi-slash-circle',
                fields: [
                    { key: 'exceptDripping1', label: 'Excluir Y1', tipo: 'check' },
                    { key: 'exceptDripping2', label: 'Excluir Y2', tipo: 'check' },
                    { key: 'exceptDripping3', label: 'Excluir Y3', tipo: 'check' },
                    { key: 'exceptDripping4', label: 'Excluir Y4', tipo: 'check' }
                ]
            },
            {
                title: 'Posiciones',
                icon: 'bi-geo-alt',
                fields: [
                    { key: 'dipStartPosition', label: 'Posición Inicial Z (mm)', step: 0.1 },
                    { key: 'dippingLength', label: 'Longitud de Inmersión (mm)', step: 0.1 },
                    { key: 'transferSpeed', label: 'Velocidad Transferencia Y (mm/s)', step: 0.1,
                      max: RecipesScreen.MAX_TRANSFER_SPEED_MMS, unidad: 'mm/s' },
                    { key: 'dipSpeed', label: 'Velocidad Inmersión Z (mm/s)', step: 0.1,
                      max: RecipesScreen.MAX_Z_SPEED_MMS, unidad: 'mm/s' },
                    { key: 'emersionSpeed', label: 'Velocidad Emersión Z (mm/s)', step: 0.1,
                      max: RecipesScreen.MAX_Z_SPEED_MMS, unidad: 'mm/s',
                      placeholder: 'Igual que inmersión' },
                    { key: 'posY1', label: 'Vaso 1 (mm)', step: 0.1, min: 0,
                      max: RecipesScreen.MAX_VESSEL_POSITION_MM, unidad: 'mm', placeholder: 'Calibrada' },
                    { key: 'posY2', label: 'Vaso 2 (mm)', step: 0.1, min: 0,
                      max: RecipesScreen.MAX_VESSEL_POSITION_MM, unidad: 'mm', placeholder: 'Calibrada' },
                    { key: 'posY3', label: 'Vaso 3 (mm)', step: 0.1, min: 0,
                      max: RecipesScreen.MAX_VESSEL_POSITION_MM, unidad: 'mm', placeholder: 'Calibrada' },
                    { key: 'posY4', label: 'Vaso 4 (mm)', step: 0.1, min: 0,
                      max: RecipesScreen.MAX_VESSEL_POSITION_MM, unidad: 'mm', placeholder: 'Calibrada' }
                ]
            }
        ];
    }

    /**
     * Lo que tarda una inmersión completa, en milisegundos: bajar el sustrato a
     * la solución y volver a sacarlo. Los dos recorridos miden lo mismo pero ya
     * no tienen por qué durar lo mismo, así que se suman por separado en vez de
     * multiplicar uno por dos.
     */
    static tiempoInmersionMs(dippingLength, dipSpeed, emersionSpeed) {
        if (dipSpeed <= 0 || emersionSpeed <= 0) return 0;
        return (dippingLength / dipSpeed + dippingLength / emersionSpeed) * 1000;
    }

    /**
     * Duración estimada de un juego de parámetros, en milisegundos. Es el mismo
     * cálculo que ya hacía el formulario simple; se saca aparte porque una
     * receta por etapas necesita aplicarlo etapa por etapa.
     */
    static durationMs(params) {
        const p = params || {};
        // Los valores por defecto son los que ya usaba el formulario cuando el
        // campo estaba vacío: sin ellos una etapa recién creada saldría con
        // duración 0 y el servidor la rechazaría (duration tiene mínimo 1).
        const dipSpeed = parseFloat(p.dipSpeed) || 10;          // mm/s
        // Vacío o 0 = sube a la misma velocidad con la que bajó.
        const emersionSpeed = parseFloat(p.emersionSpeed) || dipSpeed;
        const dippingLength = parseFloat(p.dippingLength) || 50; // mm

        // Bajar y subir en cada inmersión: dos recorridos, que ya no tienen por
        // qué durar lo mismo.
        const movementTimePerDipMs = RecipesScreen.tiempoInmersionMs(
            dippingLength, dipSpeed, emersionSpeed);

        const timePerCycleMs = (
            (parseInt(p.dippingWait0) || 0) +
            (parseInt(p.dippingWait1) || 0) +
            (parseInt(p.dippingWait2) || 0) +
            (parseInt(p.dippingWait3) || 0) +
            ((parseInt(p.transferWait) || 0) * 3) + // 3 transferencias entre vasos
            (movementTimePerDipMs * 4)              // 4 inmersiones por ciclo
        );

        return timePerCycleMs * (parseInt(p.cycles) || 1);
    }

    stageDurationMinutes(etapa) {
        return Math.ceil(RecipesScreen.durationMs(etapa) / 60000) || 1;
    }

    escapeHtml(texto) {
        return String(texto === null || texto === undefined ? '' : texto)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    isStagedMode() {
        const selector = document.getElementById('recipe-mode');
        return !!selector && selector.value === 'staged';
    }

    /**
     * Resumen equivalente al que calcula el servidor (buildStagedSummary), para
     * poder pintar la receta recién guardada sin volver a pedirla.
     */
    stagedSummary(etapas) {
        if (!Array.isArray(etapas) || etapas.length === 0) return {};
        return {
            ...etapas[0],
            name: undefined,
            duration: etapas.reduce((total, e) => total + (parseInt(e.duration) || 0), 0),
            cycles: etapas.reduce((total, e) => total + (parseInt(e.cycles) || 0), 0)
        };
    }

    /**
     * Convierte lo que hay escrito en el formulario de receta normal en una
     * etapa. Al pasar una receta normal a por etapas, la primera etapa es la
     * receta que ya estaba: los campos del formulario simple llevan como name
     * exactamente las mismas claves que una etapa, así que se leen directo.
     */
    readSingleParamsAsStage() {
        const form = document.getElementById('recipe-form');
        if (!form) return this.emptyStage();

        const grupos = RecipesScreen.stageFieldGroups();

        const etapa = { name: '' };
        grupos.forEach(grupo => {
            grupo.fields.forEach(campo => {
                const input = form.querySelector(`#recipe-single-params [name="${campo.key}"]`);
                if (!input) return;

                if (input.type === 'checkbox') {
                    etapa[campo.key] = input.checked;
                } else if (campo.key === 'fan') {
                    etapa[campo.key] = input.value === 'true';
                } else if (RecipesScreen.STAGE_INT_FIELDS.has(campo.key)) {
                    etapa[campo.key] = parseInt(input.value, 10) || 0;
                } else {
                    etapa[campo.key] = parseFloat(input.value) || 0;
                }
            });
        });

        if (!etapa.cycles || etapa.cycles < 1) etapa.cycles = 1;
        etapa.duration = this.stageDurationMinutes(etapa);
        return etapa;
    }

    emptyStage() {
        const config = this.systemConfig || {};
        return {
            name: '',
            cycles: 1,
            fan: false,
            humidityOffset: config.humidity_offset || 0,
            temperatureOffset: config.temperature_offset || 0
        };
    }

    /**
     * Cambia entre receta normal y receta por etapas: son dos formularios
     * distintos dentro del mismo modal, y solo uno de los dos se guarda.
     */
    setRecipeMode(esPorEtapas) {
        const selector = document.getElementById('recipe-mode');
        if (selector) selector.value = esPorEtapas ? 'staged' : 'single';

        const camposSimples = document.getElementById('recipe-single-params');
        const seccionEtapas = document.getElementById('recipe-stages-section');
        if (camposSimples) camposSimples.classList.toggle('d-none', esPorEtapas);
        if (seccionEtapas) seccionEtapas.classList.toggle('d-none', !esPorEtapas);

        if (esPorEtapas) {
            if (!Array.isArray(this.stagesDraft) || this.stagesDraft.length === 0) {
                this.stagesDraft = [this.readSingleParamsAsStage()];
                this.stageAbierta = 0;
            }
            this.renderStages();
        }

        this.updateAutoDuration(document.getElementById('recipe-form'));
    }

    stageFieldHtml(indice, campo, etapa) {
        const valor = etapa ? etapa[campo.key] : undefined;
        const id = `stage-${indice}-${campo.key}`;

        if (campo.tipo === 'check') {
            return `
                <div class="col-6 col-md-3">
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" data-field="${campo.key}"
                               id="${id}" ${valor ? 'checked' : ''}>
                        <label class="form-check-label small" for="${id}">${campo.label}</label>
                    </div>
                </div>`;
        }

        if (campo.tipo === 'select') {
            const opciones = campo.opciones.map(([v, texto]) =>
                `<option value="${v}" ${String(!!valor) === v ? 'selected' : ''}>${texto}</option>`
            ).join('');
            return `
                <div class="col-6 col-md-4">
                    <label class="form-label x-small text-muted mb-1" for="${id}">${campo.label}</label>
                    <select class="form-control form-control-sm" data-field="${campo.key}" id="${id}">${opciones}</select>
                </div>`;
        }

        const atributos = [
            campo.min !== undefined ? `min="${campo.min}"` : '',
            campo.max !== undefined ? `max="${campo.max}"` : '',
            campo.step !== undefined ? `step="${campo.step}"` : '',
            campo.placeholder ? `placeholder="${campo.placeholder}"` : '',
            campo.max !== undefined ? `title="Máximo: ${campo.max} ${campo.unidad || ''}"` : ''
        ].filter(Boolean).join(' ');

        // Un 0 se muestra como campo vacío, igual que en el formulario simple:
        // en las posiciones de vaso el 0 significa "usa la geometría calibrada",
        // y escribirlo parecería una posición elegida a propósito.
        const mostrado = (valor === undefined || valor === null || valor === '' || valor === 0)
            ? (campo.defecto !== undefined ? campo.defecto : '')
            : valor;

        return `
            <div class="col-6 col-md-4">
                <label class="form-label x-small text-muted mb-1" for="${id}">${campo.label}</label>
                <input type="number" class="form-control form-control-sm" data-field="${campo.key}"
                       id="${id}" ${atributos} value="${mostrado}">
            </div>`;
    }

    stageCardHtml(indice, etapa, total) {
        const grupos = RecipesScreen.stageFieldGroups();
        const cuerpoId = `stage-body-${indice}`;
        const abierto = total === 1 || indice === this.stageAbierta;

        const secciones = grupos.map(grupo => `
            <div class="col-12 mt-2">
                <h6 class="fw-bold text-primary small mb-1">
                    <i class="bi ${grupo.icon} me-1"></i>${grupo.title}
                </h6>
            </div>
            ${grupo.fields.map(campo => this.stageFieldHtml(indice, campo, etapa)).join('')}
        `).join('');

        return `
            <div class="card mb-2 stage-card" data-stage-index="${indice}">
                <div class="card-header d-flex align-items-center gap-1 py-2">
                    <button type="button" class="btn btn-sm btn-link text-decoration-none flex-grow-1 text-start p-0"
                            data-bs-toggle="collapse" data-bs-target="#${cuerpoId}">
                        <span class="badge bg-primary me-2">Etapa ${indice + 1}</span>
                        <span class="stage-resumen small text-muted"></span>
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-stage-action="up"
                            title="Subir" ${indice === 0 ? 'disabled' : ''}><i class="bi bi-arrow-up"></i></button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-stage-action="down"
                            title="Bajar" ${indice === total - 1 ? 'disabled' : ''}><i class="bi bi-arrow-down"></i></button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-stage-action="copy"
                            title="Duplicar etapa"><i class="bi bi-files"></i></button>
                    <button type="button" class="btn btn-sm btn-outline-danger" data-stage-action="remove"
                            title="Eliminar etapa" ${total <= 1 ? 'disabled' : ''}><i class="bi bi-trash"></i></button>
                </div>
                <div class="collapse ${abierto ? 'show' : ''}" id="${cuerpoId}">
                    <div class="card-body py-2">
                        <div class="row g-2">
                            <div class="col-12">
                                <label class="form-label x-small text-muted mb-1">Nombre de la etapa (opcional)</label>
                                <input type="text" class="form-control form-control-sm" data-field="name"
                                       maxlength="100" placeholder="Ej. Precursor concentrado"
                                       value="${this.escapeHtml(etapa && etapa.name ? etapa.name : '')}">
                            </div>
                            ${secciones}
                        </div>
                    </div>
                </div>
            </div>`;
    }

    renderStages() {
        const lista = document.getElementById('recipe-stages-list');
        if (!lista) return;

        lista.innerHTML = this.stagesDraft
            .map((etapa, i) => this.stageCardHtml(i, etapa, this.stagesDraft.length))
            .join('');

        lista.querySelectorAll('.stage-card').forEach(tarjeta => {
            const indice = parseInt(tarjeta.dataset.stageIndex, 10);

            tarjeta.querySelectorAll('[data-stage-action]').forEach(boton => {
                boton.addEventListener('click', () => this.stageAction(boton.dataset.stageAction, indice));
            });

            tarjeta.querySelectorAll('[data-field]').forEach(input => {
                input.addEventListener('input', () => this.onStageFieldInput());
                input.addEventListener('change', () => this.onStageFieldInput());
            });
        });

        this.refreshStageSummaries();

        const contador = document.getElementById('recipe-stages-count');
        if (contador) contador.textContent = `${this.stagesDraft.length} / ${RecipesScreen.MAX_STAGES}`;

        const botonAgregar = document.getElementById('add-stage-btn');
        if (botonAgregar) botonAgregar.disabled = this.stagesDraft.length >= RecipesScreen.MAX_STAGES;
    }

    /**
     * La cabecera de cada etapa dice de un vistazo cuántos ciclos lleva y cuánto
     * dura, que es lo que se quiere comparar entre etapas sin abrirlas todas.
     */
    refreshStageSummaries() {
        document.querySelectorAll('#recipe-stages-list .stage-card').forEach(tarjeta => {
            const indice = parseInt(tarjeta.dataset.stageIndex, 10);
            const etapa = this.stagesDraft[indice] || {};
            const resumen = tarjeta.querySelector('.stage-resumen');
            if (!resumen) return;

            const partes = [];
            if (etapa.name) partes.push(etapa.name);
            partes.push(`${etapa.cycles || 1} ciclos`);
            partes.push(`~${this.stageDurationMinutes(etapa)} min`);
            resumen.textContent = partes.join(' · ');
        });
    }

    onStageFieldInput() {
        this.syncStagesFromDom();
        this.refreshStageSummaries();
        this.updateAutoDuration(document.getElementById('recipe-form'));
    }

    /**
     * Vuelca lo que hay escrito en las tarjetas a this.stagesDraft. Se llama
     * antes de cualquier cambio de estructura (agregar, mover, borrar) porque
     * la lista se vuelve a pintar entera y lo no volcado se perdería.
     */
    syncStagesFromDom() {
        const tarjetas = document.querySelectorAll('#recipe-stages-list .stage-card');
        if (tarjetas.length === 0) return;
        this.stagesDraft = Array.from(tarjetas).map(tarjeta => this.readStageFromCard(tarjeta));
    }

    readStageFromCard(tarjeta) {
        const etapa = {};

        tarjeta.querySelectorAll('[data-field]').forEach(input => {
            const clave = input.dataset.field;
            if (input.type === 'checkbox') {
                etapa[clave] = input.checked;
            } else if (clave === 'fan') {
                etapa[clave] = input.value === 'true';
            } else if (clave === 'name') {
                etapa[clave] = input.value.trim();
            } else if (RecipesScreen.STAGE_INT_FIELDS.has(clave)) {
                etapa[clave] = parseInt(input.value, 10) || 0;
            } else {
                etapa[clave] = parseFloat(input.value) || 0;
            }
        });

        if (!etapa.cycles || etapa.cycles < 1) etapa.cycles = 1;
        etapa.duration = this.stageDurationMinutes(etapa);
        return etapa;
    }

    stageAction(accion, indice) {
        this.syncStagesFromDom();
        const etapas = this.stagesDraft;

        if (accion === 'up' && indice > 0) {
            [etapas[indice - 1], etapas[indice]] = [etapas[indice], etapas[indice - 1]];
            this.stageAbierta = indice - 1;
        } else if (accion === 'down' && indice < etapas.length - 1) {
            [etapas[indice], etapas[indice + 1]] = [etapas[indice + 1], etapas[indice]];
            this.stageAbierta = indice + 1;
        } else if (accion === 'copy') {
            if (etapas.length >= RecipesScreen.MAX_STAGES) {
                this.app.showError(`Una receta admite como máximo ${RecipesScreen.MAX_STAGES} etapas`);
                return;
            }
            etapas.splice(indice + 1, 0, { ...etapas[indice], name: '' });
            this.stageAbierta = indice + 1;
        } else if (accion === 'remove') {
            if (etapas.length <= 1) return;
            etapas.splice(indice, 1);
            this.stageAbierta = Math.min(indice, etapas.length - 1);
        }

        this.renderStages();
        this.updateAutoDuration(document.getElementById('recipe-form'));
    }

    addStage() {
        this.syncStagesFromDom();

        if (this.stagesDraft.length >= RecipesScreen.MAX_STAGES) {
            this.app.showError(`Una receta admite como máximo ${RecipesScreen.MAX_STAGES} etapas`);
            return;
        }

        // La etapa nueva sale copiada de la anterior: encadenar etapas casi
        // siempre es repetir el mismo baño cambiando un par de tiempos o los
        // ciclos, y rellenar veinte campos desde cero por cada etapa es justo el
        // trabajo que el operador estaba evitando al pedir esto.
        const ultima = this.stagesDraft[this.stagesDraft.length - 1];
        this.stagesDraft.push(ultima ? { ...ultima, name: '' } : this.emptyStage());
        this.stageAbierta = this.stagesDraft.length - 1;

        this.renderStages();
        this.updateAutoDuration(document.getElementById('recipe-form'));
    }

    /**
     * Mismos topes que valida el formulario simple, aplicados a una etapa.
     * Devuelve el motivo del rechazo o null si la etapa es válida.
     */
    validateStageLimits(etapa) {
        if ((etapa.cycles || 0) < 1) {
            return 'la cantidad de ciclos debe ser al menos 1';
        }
        if ((etapa.transferSpeed || 0) > RecipesScreen.MAX_TRANSFER_SPEED_MMS) {
            return `la velocidad de transferencia Y no puede exceder ${RecipesScreen.MAX_TRANSFER_SPEED_MMS} mm/s`;
        }
        if ((etapa.dipSpeed || 0) > RecipesScreen.MAX_Z_SPEED_MMS) {
            return `la velocidad de inmersión Z no puede exceder ${RecipesScreen.MAX_Z_SPEED_MMS} mm/s`;
        }
        if ((etapa.emersionSpeed || 0) > RecipesScreen.MAX_Z_SPEED_MMS) {
            return `la velocidad de emersión Z no puede exceder ${RecipesScreen.MAX_Z_SPEED_MMS} mm/s`;
        }
        for (let i = 1; i <= 4; i++) {
            const mm = etapa[`posY${i}`] || 0;
            if (mm < 0 || mm > RecipesScreen.MAX_VESSEL_POSITION_MM) {
                return `la posición del vaso ${i} debe estar entre 0 y ${RecipesScreen.MAX_VESSEL_POSITION_MM} mm`;
            }
        }
        return null;
    }

    async saveRecipe(recipeId = null) {
        const form = document.getElementById('recipe-form');
        const formData = new FormData(form);

        // Validación básica
        const name = formData.get('name')?.trim();
        if (!name) {
            this.app.showError('El nombre de la receta es obligatorio');
            return;
        }

        // Receta por etapas: los parámetros no salen de los campos de arriba
        // (están ocultos y vacíos) sino de la lista de etapas. El resumen que se
        // guarda en recipe_parameters lo calcula el servidor.
        if (this.isStagedMode()) {
            this.syncStagesFromDom();
            const etapas = this.stagesDraft;

            if (etapas.length === 0) {
                this.app.showError('Una receta por etapas necesita al menos una etapa');
                return;
            }
            if (etapas.length > RecipesScreen.MAX_STAGES) {
                this.app.showError(`Una receta admite como máximo ${RecipesScreen.MAX_STAGES} etapas`);
                return;
            }

            for (let i = 0; i < etapas.length; i++) {
                const problema = this.validateStageLimits(etapas[i]);
                if (problema) {
                    this.app.showError(`Etapa ${i + 1}: ${problema}`);
                    // Abrir la etapa que falla: con ocho tarjetas plegadas, decir
                    // el número no basta para encontrar el campo.
                    this.stageAbierta = i;
                    this.renderStages();
                    return;
                }
            }

            await this.persistRecipe(recipeId, {
                name: name,
                type: formData.get('type') || 'A',
                description: formData.get('description')?.trim() || '',
                isStaged: true,
                stages: etapas
            });
            return;
        }

        // Validar límites antes de guardar. Las tres velocidades llegan al
        // firmware y van en mm/s. Antes se validaban como si fueran la velocidad y
        // la aceleración del eje Z en rpm, contra un tope de 100: eso rechazaba
        // valores perfectamente válidos y dejaba pasar otros que el eje no puede dar.
        const transferSpeed = parseFloat(formData.get('transferSpeed')) || 0;
        const dipSpeed = parseFloat(formData.get('dipSpeed')) || 0;
        // Vacío = 0 = subir a la misma velocidad de la inmersión, que es como se
        // comportaba el sistema antes de que este campo existiera.
        const emersionSpeed = parseFloat(formData.get('emersionSpeed')) || 0;

        if (transferSpeed > RecipesScreen.MAX_TRANSFER_SPEED_MMS) {
            this.app.showError(`La velocidad de transferencia Y no puede exceder ${RecipesScreen.MAX_TRANSFER_SPEED_MMS} mm/s`);
            form.querySelector('#recipe-transfer-speed').focus();
            return;
        }

        if (dipSpeed > RecipesScreen.MAX_Z_SPEED_MMS) {
            this.app.showError(`La velocidad de inmersión Z no puede exceder ${RecipesScreen.MAX_Z_SPEED_MMS} mm/s`);
            form.querySelector('#recipe-dip-speed').focus();
            return;
        }

        if (emersionSpeed > RecipesScreen.MAX_Z_SPEED_MMS) {
            this.app.showError(`La velocidad de emersión Z no puede exceder ${RecipesScreen.MAX_Z_SPEED_MMS} mm/s`);
            form.querySelector('#recipe-emersion-speed').focus();
            return;
        }

        // Posición de cada vaso. Vacío o 0 = usar la geometría calibrada de la
        // máquina; cualquier otro valor tiene que caber en el recorrido del eje,
        // porque si no la transferencia se va contra el final de carrera y el
        // sustrato se sumerge en el sitio equivocado.
        const posicionesVaso = [];
        for (let i = 1; i <= 4; i++) {
            const mm = parseFloat(formData.get(`posY${i}`)) || 0;
            if (mm < 0 || mm > RecipesScreen.MAX_VESSEL_POSITION_MM) {
                this.app.showError(`La posición del vaso ${i} debe estar entre 0 y ${RecipesScreen.MAX_VESSEL_POSITION_MM} mm`);
                form.querySelector(`#recipe-pos-y${i}`).focus();
                return;
            }
            posicionesVaso.push(mm);
        }

        const recipeData = {
            name: name,
            type: formData.get('type') || 'A',
            description: formData.get('description')?.trim() || '',
            parameters: {
                duration: parseInt(formData.get('duration')) || 0,
                temperature: parseFloat(formData.get('temperature')) || 0,
                humidityOffset: parseFloat(formData.get('humidityOffset')) || 0,
                temperatureOffset: parseFloat(formData.get('temperatureOffset')) || 0,
                // Tiempos de inmersión (en milisegundos)
                dippingWait0: parseInt(formData.get('dippingWait0')) || 0,
                dippingWait1: parseInt(formData.get('dippingWait1')) || 0,
                dippingWait2: parseInt(formData.get('dippingWait2')) || 0,
                dippingWait3: parseInt(formData.get('dippingWait3')) || 0,
                transferWait: parseInt(formData.get('transferWait')) || 0,
                // Parámetros de proceso
                cycles: parseInt(formData.get('cycles')) || 1,
                fan: formData.get('fan') === 'true',
                exceptDripping1: formData.get('exceptDripping1') === 'true',
                exceptDripping2: formData.get('exceptDripping2') === 'true',
                exceptDripping3: formData.get('exceptDripping3') === 'true',
                exceptDripping4: formData.get('exceptDripping4') === 'true',
                // Posiciones
                dipStartPosition: parseFloat(formData.get('dipStartPosition')) || 0,
                dippingLength: parseFloat(formData.get('dippingLength')) || 0,
                transferSpeed: transferSpeed,
                dipSpeed: dipSpeed,
                // 0 = subir a la misma velocidad de bajada
                emersionSpeed: emersionSpeed,
                // Posición de cada vaso desde el home de Y, en mm.
                // 0 = usar la geometría calibrada de la máquina.
                posY1: posicionesVaso[0],
                posY2: posicionesVaso[1],
                posY3: posicionesVaso[2],
                posY4: posicionesVaso[3]
                // Variables Pendiente (COMENTADAS - No implementadas)
                // setTemp1: parseFloat(formData.get('setTemp1')) || 0,
                // setTemp2: parseFloat(formData.get('setTemp2')) || 0,
                // setTemp3: parseFloat(formData.get('setTemp3')) || 0,
                // setTemp4: parseFloat(formData.get('setTemp4')) || 0,
                // setStirr1: parseFloat(formData.get('setStirr1')) || 0,
                // setStirr2: parseFloat(formData.get('setStirr2')) || 0,
                // setStirr3: parseFloat(formData.get('setStirr3')) || 0,
                // setStirr4: parseFloat(formData.get('setStirr4')) || 0,
            }
        };
        


        await this.persistRecipe(recipeId, recipeData);
    }

    /**
     * Manda la receta al servidor y refresca la lista local. Es lo único que
     * comparten la receta normal y la receta por etapas: cambia cómo se arma
     * recipeData, no cómo se guarda.
     */
    async persistRecipe(recipeId, recipeData) {
        // La lista y el panel de detalles leen is_staged y parameters. Una receta
        // por etapas no trae parameters (los calcula el servidor), así que aquí se
        // repite ese resumen para no tener que volver a pedir la receta entera.
        const datosLocales = {
            ...recipeData,
            is_staged: !!recipeData.isStaged,
            parameters: recipeData.parameters || this.stagedSummary(recipeData.stages)
        };

        // Preparar variables para el manejo del botón
        const saveBtn = document.getElementById('save-recipe-btn');
        const originalText = saveBtn.textContent;
        
        try {
            // Mostrar loading en el botón
            saveBtn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Guardando...';
            saveBtn.disabled = true;

            if (recipeId) {
                // Editar receta existente
                await this.app.apiCall(`/recipes/${recipeId}`, {
                    method: 'PUT',
                    body: JSON.stringify(recipeData)
                });
                
                // Actualizar datos localmente después de la respuesta exitosa del backend
                const recipeIndex = this.recipes.findIndex(r => r.id == recipeId);
                if (recipeIndex !== -1) {
                    this.recipes[recipeIndex] = {
                        ...this.recipes[recipeIndex],
                        ...datosLocales,
                        updated_at: new Date().toISOString()
                    };
                }
                
                this.app.showSuccess('Receta actualizada correctamente');
            } else {
                // Crear nueva receta
                const response = await this.app.apiCall('/recipes', {
                    method: 'POST',
                    body: JSON.stringify(recipeData)
                });
                
                // Agregar a la lista local después de la respuesta exitosa del backend
                const newRecipe = {
                    id: response.recipeId || Date.now(), // Usar ID del backend si está disponible
                    ...datosLocales,
                    created_by_user_id: this.app.userSession?.userId || 1,
                    created_by_name: this.app.userSession?.fullName || 'Administrador del Sistema',
                    created_at: new Date().toISOString()
                };
                this.recipes.unshift(newRecipe);
                
                this.app.showSuccess('Receta creada correctamente');
            }

            // Cerrar modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('recipe-form-modal'));
            modal.hide();
            
            // Actualizar la vista sin recargar desde el servidor
            this.renderRecipesList();
            this.updateActionButtons();

            // Si estamos editando, actualizar la selección y detalles
            if (recipeId) {
                this.selectedRecipe = this.recipes.find(r => r.id == recipeId);
                if (this.selectedRecipe) {
                    this.updateRecipeDetails();
                    // Resaltar la receta editada
                    this.highlightSelectedRecipe();
                }
            }

        } catch (error) {
            console.error('Error guardando receta:', error);
            // Mostrar el mensaje de error específico del servidor si está disponible
            const errorMessage = error.message && error.message !== 'API Error: 500' 
                ? error.message 
                : 'Error guardando la receta';
            this.app.showError(errorMessage);
        } finally {
            // Restaurar botón
            const saveBtn = document.getElementById('save-recipe-btn');
            saveBtn.innerHTML = originalText;
            saveBtn.disabled = false;
        }
    }

    async executeSelectedRecipe() {
        if (!this.selectedRecipe) return;

        // Verificar si hay un proceso ejecutándose antes de intentar iniciar.
        // Se pregunta al estado global, no al de la pantalla, porque este puede
        // llevar hasta un segundo de retraso.
        if (this.app.hayProcesoEnCurso()) {
            this.app.showError('Ya hay un proceso ejecutándose. Debe detenerlo antes de iniciar uno nuevo.');
            // Navegar a la pantalla de proceso para que el usuario pueda detenerlo
            setTimeout(() => {
                this.app.navigateToScreen('process');
            }, 2000);
            return;
        }

        try {
            const result = await this.app.apiCall('/process/start', {
                method: 'POST',
                body: JSON.stringify({
                    recipeId: this.selectedRecipe.id
                })
            });

            if (result && result.success) {
                this.app.showSuccess('Proceso iniciado correctamente');
                // Actualizar estado del proceso
                this.processStatus = 'running';
                this.updateActionButtons();
                // Emitir evento para que otras pantallas se actualicen
                document.dispatchEvent(new CustomEvent('process-status-changed'));
                // Navegar a la pantalla de proceso
                this.app.navigateToScreen('process');
            }

        } catch (error) {
            // Manejar error específico cuando ya hay un proceso ejecutándose
            if (error.status === 409) {
                const errorData = error.responseData ? JSON.parse(error.responseData) : null;
                const message = errorData?.message || 'Ya hay un proceso ejecutándose. Debe detenerlo antes de iniciar uno nuevo.';
                this.app.showError(message);
                // Actualizar estado local
                this.processStatus = 'running';
                this.updateActionButtons();
                // Navegar a la pantalla de proceso después de 2 segundos
                setTimeout(() => {
                    this.app.navigateToScreen('process');
                }, 2000);
            } else {
                const errorMessage = error.message || 'Error iniciando el proceso';
                this.app.showError(errorMessage);
            }
        }
    }

    async editSelectedRecipe() {
        if (!this.selectedRecipe) return;
        
        // Verificar permisos
        if (!this.canUserEditRecipe(this.selectedRecipe)) {
            this.app.showError('No tiene permisos para editar esta receta');
            return;
        }
        
        this.showRecipeForm(this.selectedRecipe);
    }

    async deleteSelectedRecipe() {
        if (!this.selectedRecipe) return;

        // Verificar permisos
        if (!this.canUserEditRecipe(this.selectedRecipe)) {
            this.app.showError('No tiene permisos para eliminar esta receta');
            return;
        }

        // Mostrar modal de confirmación personalizado
        this.showDeleteConfirmationModal(this.selectedRecipe);
    }

    showDeleteConfirmationModal(recipe) {
        const modalHtml = `
            <div class="modal fade" id="delete-confirmation-modal" tabindex="-1">
                <div class="modal-dialog modal-sm">
                    <div class="modal-content">
                        <div class="modal-header bg-danger text-white">
                            <h5 class="modal-title">
                                <i class="bi bi-exclamation-triangle me-2"></i>
                                Confirmar Eliminación
                            </h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <p>¿Está seguro que desea eliminar la receta:</p>
                            <div class="alert alert-warning">
                                <strong>${recipe.name}</strong>
                                <br>
                                <small class="text-muted">Creada por: ${recipe.created_by_name}</small>
                            </div>
                            <p class="text-danger mb-0">
                                <i class="bi bi-info-circle me-1"></i>
                                Esta acción no se puede deshacer.
                            </p>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                            <button type="button" class="btn btn-danger" id="confirm-delete-btn">
                                <i class="bi bi-trash me-1"></i>
                                Eliminar Receta
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remover modal anterior si existe
        const existingModal = document.getElementById('delete-confirmation-modal');
        if (existingModal) {
            bootstrap.Modal.getInstance(existingModal)?.dispose();
            existingModal.remove();
        }

        // Agregar nuevo modal al DOM
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Mostrar modal
        const modal = new bootstrap.Modal(document.getElementById('delete-confirmation-modal'), { focus: false });
        modal.show();

        // Bind confirm button
        document.getElementById('confirm-delete-btn').onclick = async () => {
            const confirmBtn = document.getElementById('confirm-delete-btn');
            const originalText = confirmBtn.innerHTML;
            
            try {
                // Mostrar loading
                confirmBtn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Eliminando...';
                confirmBtn.disabled = true;

                // Eliminar receta en el backend
                await this.app.apiCall(`/recipes/${recipe.id}`, {
                    method: 'DELETE'
                });

                // Cerrar modal
                modal.hide();
                
                // Limpiar selección y recargar
                this.selectedRecipe = null;
                await this.loadRecipes();
                
                // Ocultar barra de acciones
                const actionBar = document.getElementById('action-bar');
                if (actionBar) {
                    actionBar.style.display = 'none';
                }

                this.app.showSuccess('Receta eliminada correctamente');

            } catch (error) {
                console.error('Error eliminando receta:', error);
                this.app.showError('Error eliminando la receta');
            } finally {
                // Restaurar botón siempre
                confirmBtn.innerHTML = originalText;
                confirmBtn.disabled = false;
            }
        };

        // Limpiar modal al cerrar
        document.getElementById('delete-confirmation-modal').addEventListener('hidden.bs.modal', function() {
            this.remove();
        });
    }

    static getTemplate() {
        return `
            <div class="recipes-container">
                <!-- Header Section -->
                <div class="recipes-header">
                    <div class="header-content">
                        <div class="header-info">
                            <h2 class="header-title">
                                <i class="bi bi-journal-code me-3"></i>
                                Gestión de Recetas
                            </h2>
                            <p class="header-subtitle">Administre las recetas para síntesis de películas delgadas por método SILAR</p>
                        </div>
                        <button class="btn btn-new-recipe" id="new-recipe-btn">
                            <i class="bi bi-plus-lg me-2"></i>
                            Nueva Receta
                        </button>
                    </div>
                </div>

                <!-- Main Content Area -->
                <div class="recipes-main-content">
                    <!-- Recipes Grid -->
                    <div class="recipes-grid-section">
                        <div class="section-header">
                            <h4 class="section-title">
                                <i class="bi bi-collection me-2"></i>
                                Recetas Disponibles
                            </h4>
                            <div class="section-actions">
                                <div class="search-box">
                                    <i class="bi bi-search"></i>
                                    <input type="text" placeholder="Buscar recetas..." id="recipe-search">
                                </div>
                            </div>
                        </div>
                        
                        <div class="recipes-grid" id="recipes-list">
                            <div class="loading-state">
                                <div class="loading-spinner"></div>
                                <p>Cargando recetas...</p>
                            </div>
                        </div>
                    </div>

                    <!-- Recipe Details Panel -->
                    <div class="recipe-details-panel" id="recipe-details">
                        <div class="details-placeholder">
                            <div class="placeholder-icon">
                                <i class="bi bi-info-circle"></i>
                            </div>
                            <h5>Seleccione una receta</h5>
                            <p>Los detalles se mostrarán aquí</p>
                        </div>
                    </div>
                </div>

                <!-- Action Bar -->
                <div class="action-bar" id="action-bar" style="display: none;">
                    <div class="action-buttons">
                        <button class="btn-action btn-secondary" id="execute-recipe-btn" disabled>
                            <i class="bi bi-play-fill"></i>
                            <span>Ejecutar Proceso</span>
                        </button>
                        <button class="btn-action btn-secondary" id="edit-recipe-btn" disabled>
                            <i class="bi bi-pencil"></i>
                            <span>Editar Receta</span>
                        </button>
                        <button class="btn-action btn-secondary" id="delete-recipe-btn" disabled>
                            <i class="bi bi-trash"></i>
                            <span>Eliminar Receta</span>
                        </button>
                    </div>
                </div>


            </div>

            <!-- Recipe Form Modal -->
            <div class="modal fade" id="recipe-form-modal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="recipe-form-title">Nueva Receta</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <form id="recipe-form">
                                <div class="row g-2">
                                    <div class="col-md-5">
                                        <label class="form-label">Nombre de la Receta</label>
                                        <input type="text" class="form-control" name="name" id="recipe-name" required>
                                    </div>
                                    <div class="col-md-3">
                                        <label class="form-label">Tipo de Receta</label>
                                        <select class="form-control" name="type" id="recipe-type">
                                            <option value="A">Tipo A</option>
                                            <option value="B">Tipo B</option>
                                            <option value="C">Tipo C</option>
                                            <option value="D">Tipo D</option>
                                        </select>
                                    </div>
                                    <div class="col-md-4">
                                        <label class="form-label">Modo</label>
                                        <select class="form-control" name="mode" id="recipe-mode">
                                            <option value="single">Receta normal</option>
                                            <option value="staged">Receta por etapas</option>
                                        </select>
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">Duración Estimada (minutos)</label>
                                        <input type="number" class="form-control" name="duration" id="recipe-duration" readonly>
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label">Descripción</label>
                                        <textarea class="form-control" name="description" id="recipe-description" rows="2"></textarea>
                                    </div>

                                    <!-- Parámetros de una receta normal. En una receta por etapas
                                         este bloque se oculta entero, porque cada etapa lleva su
                                         propia copia de estos mismos campos. -->
                                    <div class="col-12" id="recipe-single-params">
                                      <div class="row g-2">
                                      <div class="col-md-6">
                                          <label class="form-label">Temperatura (°C)</label>
                                          <input type="number" class="form-control" name="temperature" id="recipe-temperature" step="0.1">
                                      </div>
                                      <div class="col-md-6">
                                          <label class="form-label">Offset Humedad (%)</label>
                                          <input type="number" class="form-control" name="humidityOffset" id="recipe-humidity-offset" step="0.1">
                                      </div>
                                      <div class="col-md-6">
                                          <label class="form-label">Offset Temperatura (°C)</label>
                                          <input type="number" class="form-control" name="temperatureOffset" id="recipe-temp-offset" step="0.1">
                                      </div>
                                    
                                      <!-- Tiempos de Inmersión -->
                                      <div class="col-12">
                                          <hr class="my-3">
                                          <h6 class="fw-bold text-primary">
                                              <i class="bi bi-clock-history me-2"></i>Tiempos de Inmersión (ms)
                                          </h6>
                                      </div>
                                      <div class="col-md-6">
                                          <label class="form-label">Tiempo de Inmersión 1 (ms)</label>
                                          <input type="number" class="form-control" name="dippingWait0" id="recipe-dipping-wait0" min="0" step="100">
                                      </div>
                                      <div class="col-md-6">
                                          <label class="form-label">Tiempo de Inmersión 2 (ms)</label>
                                          <input type="number" class="form-control" name="dippingWait1" id="recipe-dipping-wait1" min="0" step="100">
                                      </div>
                                      <div class="col-md-6">
                                          <label class="form-label">Tiempo de Inmersión 3 (ms)</label>
                                          <input type="number" class="form-control" name="dippingWait2" id="recipe-dipping-wait2" min="0" step="100">
                                      </div>
                                      <div class="col-md-6">
                                          <label class="form-label">Tiempo de Inmersión 4 (ms)</label>
                                          <input type="number" class="form-control" name="dippingWait3" id="recipe-dipping-wait3" min="0" step="100">
                                      </div>
                                      <div class="col-md-6">
                                          <label class="form-label">Tiempo de Espera Transferencia Y (ms)</label>
                                          <input type="number" class="form-control" name="transferWait" id="recipe-transfer-wait" min="0" step="100">
                                      </div>
                                    
                                      <!-- Parámetros de Proceso -->
                                      <div class="col-12">
                                          <hr class="my-3">
                                          <h6 class="fw-bold text-primary">
                                              <i class="bi bi-gear me-2"></i>Parámetros de Proceso
                                          </h6>
                                      </div>
                                      <div class="col-md-6">
                                          <label class="form-label">Cantidad de Ciclos</label>
                                          <input type="number" class="form-control" name="cycles" id="recipe-cycles" min="1" value="1">
                                      </div>
                                      <div class="col-md-6">
                                          <label class="form-label">Ventilador</label>
                                          <select class="form-control" name="fan" id="recipe-fan">
                                              <option value="false">Desactivado</option>
                                              <option value="true">Activado</option>
                                          </select>
                                      </div>
                                    
                                      <!-- Exclusión de Inmersión -->
                                      <div class="col-12">
                                          <label class="form-label fw-bold">Excluir Inmersión en Posiciones:</label>
                                      </div>
                                      <div class="col-md-3">
                                          <div class="form-check">
                                              <input class="form-check-input" type="checkbox" name="exceptDripping1" id="recipe-except-dripping1" value="true">
                                              <label class="form-check-label" for="recipe-except-dripping1">Excluir Y1</label>
                                          </div>
                                      </div>
                                      <div class="col-md-3">
                                          <div class="form-check">
                                              <input class="form-check-input" type="checkbox" name="exceptDripping2" id="recipe-except-dripping2" value="true">
                                              <label class="form-check-label" for="recipe-except-dripping2">Excluir Y2</label>
                                          </div>
                                      </div>
                                      <div class="col-md-3">
                                          <div class="form-check">
                                              <input class="form-check-input" type="checkbox" name="exceptDripping3" id="recipe-except-dripping3" value="true">
                                              <label class="form-check-label" for="recipe-except-dripping3">Excluir Y3</label>
                                          </div>
                                      </div>
                                      <div class="col-md-3">
                                          <div class="form-check">
                                              <input class="form-check-input" type="checkbox" name="exceptDripping4" id="recipe-except-dripping4" value="true">
                                              <label class="form-check-label" for="recipe-except-dripping4">Excluir Y4</label>
                                          </div>
                                      </div>
                                    
                                      <!-- Posiciones (Opcional) -->
                                      <div class="col-12">
                                          <hr class="my-3">
                                          <h6 class="fw-bold text-primary">
                                              <i class="bi bi-geo-alt me-2"></i>Posiciones (Opcional)
                                          </h6>
                                      </div>
                                      <div class="col-md-6">
                                          <label class="form-label">Posición Inicial Z (mm)</label>
                                          <input type="number" class="form-control" name="dipStartPosition" id="recipe-dip-start-position" step="0.1">
                                      </div>
                                      <div class="col-md-6">
                                          <label class="form-label">Longitud de Inmersión (mm)</label>
                                          <input type="number" class="form-control" name="dippingLength" id="recipe-dipping-length" step="0.1">
                                      </div>
                                      <div class="col-md-6">
                                          <label class="form-label">Velocidad Transferencia Y (mm/s)</label>
                                          <input type="number" class="form-control" name="transferSpeed" id="recipe-transfer-speed" step="0.1">
                                      </div>
                                      <div class="col-md-6">
                                          <label class="form-label">Velocidad Inmersión Z (mm/s)</label>
                                          <input type="number" class="form-control" name="dipSpeed" id="recipe-dip-speed" step="0.1">
                                      </div>
                                      <div class="col-md-6">
                                          <label class="form-label">Velocidad Emersión Z (mm/s)</label>
                                          <input type="number" class="form-control" name="emersionSpeed" id="recipe-emersion-speed" step="0.1" placeholder="Igual que la inmersión">
                                      </div>

                                      <div class="col-12">
                                          <label class="form-label mb-1">Posición de los vasos (mm desde el home de Y)</label>
                                          <p class="text-muted small mb-2">
                                              Solo para un montaje puntual en el que los vasos no están donde suele.
                                              <strong>Déjalos vacíos</strong> para usar la posición calibrada de la máquina,
                                              que es lo normal. Cada vaso va por su cuenta: no hace falta que estén
                                              igualmente separados.
                                          </p>
                                      </div>
                                      <div class="col-6 col-md-3">
                                          <label class="form-label x-small text-muted mb-1" for="recipe-pos-y1">Vaso 1</label>
                                          <input type="number" class="form-control" name="posY1" id="recipe-pos-y1" step="0.1" min="0" placeholder="Calibrada">
                                      </div>
                                      <div class="col-6 col-md-3">
                                          <label class="form-label x-small text-muted mb-1" for="recipe-pos-y2">Vaso 2</label>
                                          <input type="number" class="form-control" name="posY2" id="recipe-pos-y2" step="0.1" min="0" placeholder="Calibrada">
                                      </div>
                                      <div class="col-6 col-md-3">
                                          <label class="form-label x-small text-muted mb-1" for="recipe-pos-y3">Vaso 3</label>
                                          <input type="number" class="form-control" name="posY3" id="recipe-pos-y3" step="0.1" min="0" placeholder="Calibrada">
                                      </div>
                                      <div class="col-6 col-md-3">
                                          <label class="form-label x-small text-muted mb-1" for="recipe-pos-y4">Vaso 4</label>
                                          <input type="number" class="form-control" name="posY4" id="recipe-pos-y4" step="0.1" min="0" placeholder="Calibrada">
                                      </div>
                                    
                                      </div>
                                    </div>

                                    <!-- Etapas. Solo se ve cuando el modo es "Receta por etapas";
                                         cada tarjeta la pinta stageCardHtml() con los mismos
                                         parámetros que tiene una receta normal. -->
                                    <div class="col-12 d-none" id="recipe-stages-section">
                                        <hr class="my-3">
                                        <div class="d-flex align-items-center justify-content-between mb-2">
                                            <h6 class="fw-bold text-primary mb-0">
                                                <i class="bi bi-list-ol me-2"></i>Etapas de la receta
                                                <span class="badge bg-secondary ms-2" id="recipe-stages-count">0 / 8</span>
                                            </h6>
                                            <button type="button" class="btn btn-sm btn-primary" id="add-stage-btn">
                                                <i class="bi bi-plus-lg me-1"></i>Agregar etapa
                                            </button>
                                        </div>
                                        <p class="text-muted small">
                                            Las etapas se ejecutan una tras otra en una sola corrida: cuando terminan
                                            los ciclos de una empieza la siguiente sin volver al home, sin pausa y sin
                                            apagar la lámpara. Cada etapa lleva sus propios parámetros, los mismos que
                                            tendría una receta normal.
                                        </p>
                                        <div id="recipe-stages-list"></div>
                                    </div>

                                    <!-- Variables Pendiente (COMENTADAS) -->
                                    <!--
                                    <div class="col-12">
                                        <hr class="my-3">
                                        <h6 class="fw-bold text-muted">
                                            <i class="bi bi-pause-circle me-2"></i>Variables Pendiente (No implementadas)
                                        </h6>
                                        <p class="text-muted small">Estas variables están marcadas como pendientes y no están disponibles aún.</p>
                                    </div>
                                    -->
                                </div>
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                            <button type="button" class="btn btn-primary" id="save-recipe-btn">Guardar Receta</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

// Register the screen globally
window.RecipesScreen = RecipesScreen;
