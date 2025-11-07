/**
 * Recipes Screen - Gestión de recetas del sistema SILAR
 * Equivale a las pantallas 2, 3 y 4 del diseño original
 */

class RecipesScreen {
    constructor(app) {
        this.app = app;
        this.recipes = [];
        this.selectedRecipe = null;
        this.currentUser = this.app.userSession;
        this.systemConfig = null; // Configuraciones del sistema (límites y defaults)
        this.processStatus = null; // Estado del proceso actual
        this.processStatusCheckInterval = null; // Intervalo para verificar estado del proceso
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
        document.addEventListener('process-status-changed', () => {
            this.checkProcessStatus();
        });
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
     * Verifica el estado actual del proceso
     */
    async checkProcessStatus() {
        try {
            const result = await this.app.apiCall('/process/status', {
                method: 'GET'
            });
            
            if (result && result.success) {
                this.processStatus = result.status || 'stopped';
                // Actualizar botones según el estado del proceso
                this.updateActionButtons();
            }
        } catch (error) {
            console.error('Error verificando estado del proceso:', error);
            // Si hay error, asumir que no hay proceso ejecutándose
            this.processStatus = 'stopped';
            this.updateActionButtons();
        }
    }

    /**
     * Inicia el monitoreo periódico del estado del proceso
     */
    startProcessStatusMonitoring() {
        // Limpiar intervalo anterior si existe
        if (this.processStatusCheckInterval) {
            clearInterval(this.processStatusCheckInterval);
        }
        
        // Verificar cada 5 segundos
        this.processStatusCheckInterval = setInterval(() => {
            this.checkProcessStatus();
        }, 5000);
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
        document.addEventListener('click', (e) => {
            if (e.target.closest('.recipe-card')) {
                const recipeId = e.target.closest('.recipe-card').getAttribute('data-recipe-id');
                this.selectRecipe(recipeId);
            }
        });

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
                    <div class="recipe-name">${recipe.name}</div>
                    
                    <div class="params-grid">
                        <div class="param-item">
                            <span class="param-label">Duración</span>
                            <span class="param-value">${params.duration || '--'} min</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Temperatura</span>
                            <span class="param-value">${params.temperature || '--'} °C</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Velocidad X</span>
                            <span class="param-value">${params.velocityX || '--'} rpm</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Velocidad Y</span>
                            <span class="param-value">${params.velocityY || '--'} rpm</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Aceleración X</span>
                            <span class="param-value">${params.accelX || '--'} rpm/s</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Aceleración Y</span>
                            <span class="param-value">${params.accelY || '--'} rpm/s</span>
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
                            <span class="param-label">Ciclos</span>
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
        const modal = new bootstrap.Modal(document.getElementById('recipe-form-modal'));
        
        // Initialize form
        this.initRecipeForm(recipe);
        modal.show();
    }

    initRecipeForm(recipe) {
        const form = document.getElementById('recipe-form');
        if (!form) return;

        // Obtener configuraciones del sistema (límites y defaults)
        const config = this.systemConfig || {};
        const maxVelocityY = config.max_velocity_y || 1000;
        const maxVelocityZ = config.max_velocity_z || 1000;
        const maxAccelY = config.max_accel_y || 100;
        const maxAccelZ = config.max_accel_z || 100;
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
            form.querySelector('#recipe-velocity-x').value = params.velocityX || '';
            form.querySelector('#recipe-velocity-y').value = params.velocityY || '';
            form.querySelector('#recipe-accel-x').value = params.accelX || '';
            form.querySelector('#recipe-accel-y').value = params.accelY || '';
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

        // Aplicar límites máximos a los campos
        const velocityYInput = form.querySelector('#recipe-velocity-y');
        const velocityZInput = form.querySelector('#recipe-transfer-speed'); // Velocidad Z
        const accelYInput = form.querySelector('#recipe-accel-y');
        const accelZInput = form.querySelector('#recipe-dip-speed'); // Aceleración Z (velocidad de inmersión)

        if (velocityYInput) {
            velocityYInput.setAttribute('max', maxVelocityY);
            velocityYInput.setAttribute('title', `Máximo: ${maxVelocityY} rpm`);
        }
        if (velocityZInput) {
            velocityZInput.setAttribute('max', maxVelocityZ);
            velocityZInput.setAttribute('title', `Máximo: ${maxVelocityZ} rpm`);
        }
        if (accelYInput) {
            accelYInput.setAttribute('max', maxAccelY);
            accelYInput.setAttribute('title', `Máximo: ${maxAccelY} rpm/s`);
        }
        if (accelZInput) {
            accelZInput.setAttribute('max', maxAccelZ);
            accelZInput.setAttribute('title', `Máximo: ${maxAccelZ} rpm/s`);
        }

        // Agregar validación en tiempo real
        this.setupFormValidation(form, maxVelocityY, maxVelocityZ, maxAccelY, maxAccelZ);

        // Bind save event
        const saveBtn = document.getElementById('save-recipe-btn');
        saveBtn.onclick = () => this.saveRecipe(recipe?.id);
    }

    /**
     * Configura validación en tiempo real para los campos del formulario
     */
    setupFormValidation(form, maxVelocityY, maxVelocityZ, maxAccelY, maxAccelZ) {
        const velocityYInput = form.querySelector('#recipe-velocity-y');
        const velocityZInput = form.querySelector('#recipe-transfer-speed');
        const accelYInput = form.querySelector('#recipe-accel-y');
        const accelZInput = form.querySelector('#recipe-dip-speed');

        // Validar velocidad Y
        if (velocityYInput) {
            velocityYInput.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value) || 0;
                if (value > maxVelocityY) {
                    e.target.classList.add('is-invalid');
                    e.target.setCustomValidity(`El valor máximo permitido es ${maxVelocityY} rpm`);
                } else {
                    e.target.classList.remove('is-invalid');
                    e.target.setCustomValidity('');
                }
            });
        }

        // Validar velocidad Z
        if (velocityZInput) {
            velocityZInput.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value) || 0;
                if (value > maxVelocityZ) {
                    e.target.classList.add('is-invalid');
                    e.target.setCustomValidity(`El valor máximo permitido es ${maxVelocityZ} rpm`);
                } else {
                    e.target.classList.remove('is-invalid');
                    e.target.setCustomValidity('');
                }
            });
        }

        // Validar aceleración Y
        if (accelYInput) {
            accelYInput.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value) || 0;
                if (value > maxAccelY) {
                    e.target.classList.add('is-invalid');
                    e.target.setCustomValidity(`El valor máximo permitido es ${maxAccelY} rpm/s`);
                } else {
                    e.target.classList.remove('is-invalid');
                    e.target.setCustomValidity('');
                }
            });
        }

        // Validar aceleración Z
        if (accelZInput) {
            accelZInput.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value) || 0;
                if (value > maxAccelZ) {
                    e.target.classList.add('is-invalid');
                    e.target.setCustomValidity(`El valor máximo permitido es ${maxAccelZ} rpm/s`);
                } else {
                    e.target.classList.remove('is-invalid');
                    e.target.setCustomValidity('');
                }
            });
        }
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

        // Obtener configuraciones del sistema para validar límites
        const config = this.systemConfig || {};
        const maxVelocityY = config.max_velocity_y || 1000;
        const maxVelocityZ = config.max_velocity_z || 1000;
        const maxAccelY = config.max_accel_y || 100;
        const maxAccelZ = config.max_accel_z || 100;

        // Validar límites antes de guardar
        const velocityY = parseFloat(formData.get('velocityY')) || 0;
        const velocityZ = parseFloat(formData.get('transferSpeed')) || 0;
        const accelY = parseFloat(formData.get('accelY')) || 0;
        const accelZ = parseFloat(formData.get('dipSpeed')) || 0;

        if (velocityY > maxVelocityY) {
            this.app.showError(`La velocidad Y no puede exceder ${maxVelocityY} rpm`);
            form.querySelector('#recipe-velocity-y').focus();
            return;
        }

        if (velocityZ > maxVelocityZ) {
            this.app.showError(`La velocidad Z no puede exceder ${maxVelocityZ} rpm`);
            form.querySelector('#recipe-transfer-speed').focus();
            return;
        }

        if (accelY > maxAccelY) {
            this.app.showError(`La aceleración Y no puede exceder ${maxAccelY} rpm/s`);
            form.querySelector('#recipe-accel-y').focus();
            return;
        }

        if (accelZ > maxAccelZ) {
            this.app.showError(`La aceleración Z no puede exceder ${maxAccelZ} rpm/s`);
            form.querySelector('#recipe-dip-speed').focus();
            return;
        }

        const recipeData = {
            name: name,
            type: formData.get('type') || 'A',
            description: formData.get('description')?.trim() || '',
            parameters: {
                duration: parseInt(formData.get('duration')) || 0,
                temperature: parseFloat(formData.get('temperature')) || 0,
                velocityX: parseFloat(formData.get('velocityX')) || 0,
                velocityY: parseFloat(formData.get('velocityY')) || 0,
                accelX: parseFloat(formData.get('accelX')) || 0,
                accelY: parseFloat(formData.get('accelY')) || 0,
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
                transferSpeed: velocityZ,
                dipSpeed: accelZ
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
                        ...recipeData,
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
                    ...recipeData,
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

        // Verificar si hay un proceso ejecutándose antes de intentar iniciar
        if (this.processStatus === 'running' || this.processStatus === 'paused') {
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
            existingModal.remove();
        }

        // Agregar nuevo modal al DOM
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Mostrar modal
        const modal = new bootstrap.Modal(document.getElementById('delete-confirmation-modal'));
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
                                    <div class="col-md-8">
                                        <label class="form-label">Nombre de la Receta</label>
                                        <input type="text" class="form-control" name="name" id="recipe-name" required>
                                    </div>
                                    <div class="col-md-4">
                                        <label class="form-label">Tipo de Receta</label>
                                        <select class="form-control" name="type" id="recipe-type">
                                            <option value="A">Tipo A</option>
                                            <option value="B">Tipo B</option>
                                            <option value="C">Tipo C</option>
                                            <option value="D">Tipo D</option>
                                        </select>
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">Duración (minutos)</label>
                                        <input type="number" class="form-control" name="duration" id="recipe-duration" min="1" max="999">
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">Temperatura (°C)</label>
                                        <input type="number" class="form-control" name="temperature" id="recipe-temperature" step="0.1">
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label">Descripción</label>
                                        <textarea class="form-control" name="description" id="recipe-description" rows="2"></textarea>
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">Velocidad Motor X (rpm)</label>
                                        <input type="number" class="form-control" name="velocityX" id="recipe-velocity-x" step="0.1">
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">Velocidad Motor Y (rpm)</label>
                                        <input type="number" class="form-control" name="velocityY" id="recipe-velocity-y" step="0.1">
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">Aceleración Motor X (rpm/s)</label>
                                        <input type="number" class="form-control" name="accelX" id="recipe-accel-x" step="0.1">
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">Aceleración Motor Y (rpm/s)</label>
                                        <input type="number" class="form-control" name="accelY" id="recipe-accel-y" step="0.1">
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
